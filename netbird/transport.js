// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const DEFAULT_TIMEOUT_MS = 15000;
export const NETBIRD_MINIMUM_VERSION = '0.76.0';
export const NETBIRD_SOCKET_PATH = '/var/run/netbird-http.sock';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_STREAM_CHUNK_BYTES = 1024 * 1024;

export function isNetBirdSocketAvailable() {
    return GLib.file_test(getSocketPath(), GLib.FileTest.EXISTS);
}

export async function callDaemon(method, body = {}, {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const socketPath = getSocketPath();
    const requestBytes = buildRequest(method, body);

    let timeoutId = 0;
    let cancellableHandlerId = 0;
    let timedOut = false;
    const requestCancellable = new Gio.Cancellable();

    if (cancellable) {
        if (cancellable.is_cancelled()) {
            requestCancellable.cancel();
        } else {
            cancellableHandlerId = cancellable.connect(() => {
                requestCancellable.cancel();
            });
        }
    }

    if (timeoutMs > 0) {
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            timeoutId = 0;
            timedOut = true;
            requestCancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
    }

    try {
        const client = new Gio.SocketClient();
        const address = Gio.UnixSocketAddress.new(socketPath);
        const connection = await connectAsync(client, address, requestCancellable);

        try {
            await writeAllAsync(
                connection.get_output_stream(),
                requestBytes,
                requestCancellable);
            const response = await readHttpResponse(
                connection.get_input_stream(),
                requestCancellable);
            const result = {
                body: response.body,
                data: parseJsonBody(response.body),
                method,
                socketPath,
                statusCode: response.statusCode,
                statusText: response.statusText,
                timedOut: false,
            };

            if (response.statusCode < 200 || response.statusCode >= 300)
                throw new NetBirdDaemonError(result);

            if (result.data === null)
                throw new Error(`NetBird returned invalid JSON for ${method}`);

            return result;
        } finally {
            connection.close(null);
        }
    } catch (error) {
        if (error instanceof NetBirdDaemonError)
            throw error;

        if (timedOut) {
            throw new NetBirdDaemonError({
                body: `NetBird request timed out after ${timeoutMs}ms`,
                data: null,
                method,
                socketPath,
                statusCode: 0,
                statusText: 'Timeout',
                timedOut: true,
            });
        }

        throw error;
    } finally {
        if (timeoutId)
            GLib.Source.remove(timeoutId);
        if (cancellable && cancellableHandlerId)
            cancellable.disconnect(cancellableHandlerId);
    }
}

export function subscribeDaemon(method, body, {
    cancellable,
    onError,
    onMessage,
}) {
    return new DaemonSubscription(method, body, {
        cancellable,
        onError,
        onMessage,
    });
}

class DaemonSubscription {
    constructor(method, body, {cancellable, onError, onMessage}) {
        this._cancellable = new Gio.Cancellable();
        this._externalCancellable = cancellable;
        this._externalHandlerId = 0;
        this._method = method;
        this._onError = onError;
        this._onMessage = onMessage;
        this._requestBytes = buildRequest(method, body);

        if (cancellable) {
            if (cancellable.is_cancelled()) {
                this._cancellable.cancel();
            } else {
                this._externalHandlerId = cancellable.connect(() => {
                    this._cancellable.cancel();
                });
            }
        }

        void this._run();
    }

    cancel() {
        this.destroy();
    }

    destroy() {
        this._cancellable.cancel();
        this._disconnectExternalCancellable();
    }

    async _run() {
        let connection = null;
        try {
            const client = new Gio.SocketClient();
            connection = await connectAsync(
                client,
                Gio.UnixSocketAddress.new(getSocketPath()),
                this._cancellable);
            await writeAllAsync(
                connection.get_output_stream(),
                this._requestBytes,
                this._cancellable);
            await this._readStream(connection.get_input_stream());
        } catch (error) {
            if (!this._cancellable.is_cancelled())
                this._onError(error);
        } finally {
            if (connection)
                connection.close(null);
            this._disconnectExternalCancellable();
        }
    }

    async _readStream(stream) {
        const reader = new AsyncByteReader(stream, this._cancellable);
        const headerBytes = await reader.readUntil(new Uint8Array([13, 10, 13, 10]),
            MAX_HEADER_BYTES);
        const headerText = new TextDecoder().decode(headerBytes);
        const [statusLine] = headerText.split('\r\n');
        const statusMatch = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/);
        if (!statusMatch)
            throw new Error(`Invalid NetBird HTTP status line: ${statusLine}`);

        const statusCode = Number(statusMatch[1]);
        if (statusCode < 200 || statusCode >= 300) {
            throw new NetBirdDaemonError({
                body: '',
                data: null,
                method: this._method,
                socketPath: getSocketPath(),
                statusCode,
                statusText: statusMatch[2] || '',
                timedOut: false,
            });
        }

        const headers = parseHeaders(headerText);
        if (!headers.get('transfer-encoding')?.toLowerCase().includes('chunked'))
            throw new Error('NetBird status stream is not chunked');

        let jsonBuffer = new Uint8Array();
        while (!this._cancellable.is_cancelled()) {
            const sizeLine = new TextDecoder().decode(await reader.readLine());
            const sizeText = sizeLine.split(';')[0].trim();
            if (!/^[0-9a-f]+$/i.test(sizeText))
                throw new Error('Invalid NetBird status stream chunk size');

            const size = Number.parseInt(sizeText, 16);
            if (size === 0)
                throw new Error('NetBird status stream ended');
            if (size > MAX_STREAM_CHUNK_BYTES)
                throw new Error('NetBird status stream chunk is too large');

            const chunk = await reader.readExact(size);
            const terminator = await reader.readExact(2);
            if (terminator[0] !== 13 || terminator[1] !== 10)
                throw new Error('Invalid NetBird status stream chunk terminator');

            const combined = new Uint8Array(jsonBuffer.length + chunk.length);
            combined.set(jsonBuffer);
            combined.set(chunk, jsonBuffer.length);
            jsonBuffer = combined;
            if (jsonBuffer.length > MAX_STREAM_CHUNK_BYTES)
                throw new Error('NetBird status stream frame is too large');
            let newline = jsonBuffer.indexOf(10);
            while (newline !== -1) {
                const line = new TextDecoder().decode(jsonBuffer.slice(0, newline)).trim();
                jsonBuffer = jsonBuffer.slice(newline + 1);
                if (line)
                    this._handleFrame(line);
                newline = jsonBuffer.indexOf(10);
            }
        }
    }

    _handleFrame(line) {
        let frame;
        try {
            frame = JSON.parse(line);
        } catch {
            throw new Error('NetBird status stream returned invalid JSON');
        }

        if (frame.error)
            throw new Error(String(frame.error.message ?? 'NetBird status stream failed'));
        if (!frame.result || typeof frame.result !== 'object')
            throw new Error('NetBird status stream returned an invalid frame');

        this._onMessage(frame.result);
    }

    _disconnectExternalCancellable() {
        if (this._externalCancellable && this._externalHandlerId) {
            this._externalCancellable.disconnect(this._externalHandlerId);
            this._externalHandlerId = 0;
        }
    }
}

class AsyncByteReader {
    constructor(stream, cancellable) {
        this._buffer = new Uint8Array();
        this._cancellable = cancellable;
        this._stream = stream;
    }

    async readUntil(marker, maximumBytes) {
        while (true) {
            const index = findBytes(this._buffer, marker);
            if (index !== -1) {
                const result = this._buffer.slice(0, index);
                this._buffer = this._buffer.slice(index + marker.length);
                return result;
            }
            if (this._buffer.length > maximumBytes)
                throw new Error('NetBird HTTP headers are too large');
            await this._readMore();
        }
    }

    async readLine() {
        return this.readUntil(new Uint8Array([13, 10]), MAX_HEADER_BYTES);
    }

    async readExact(length) {
        if (length > MAX_STREAM_CHUNK_BYTES)
            throw new Error('NetBird status stream read is too large');

        while (this._buffer.length < length)
            await this._readMore();

        const result = this._buffer.slice(0, length);
        this._buffer = this._buffer.slice(length);
        return result;
    }

    async _readMore() {
        const bytes = await readBytesAsync(this._stream, this._cancellable);
        if (bytes.length === 0)
            throw new Error('NetBird status stream ended unexpectedly');

        const combined = new Uint8Array(this._buffer.length + bytes.length);
        combined.set(this._buffer);
        combined.set(bytes, this._buffer.length);
        this._buffer = combined;
    }
}

function buildRequest(method, body) {
    const requestBody = JSON.stringify(body ?? {});
    const bodyBytes = new TextEncoder().encode(requestBody);
    return new TextEncoder().encode([
        `POST /daemon.DaemonService/${method} HTTP/1.1`,
        'Host: localhost',
        'Content-Type: application/json',
        'Accept: application/json',
        `Content-Length: ${bodyBytes.length}`,
        'Connection: close',
        '',
        requestBody,
    ].join('\r\n'));
}

function readBytesAsync(stream, cancellable) {
    return new Promise((resolve, reject) => {
        stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable,
            (source, result) => {
                try {
                    resolve(source.read_bytes_finish(result).toArray());
                } catch (error) {
                    reject(error);
                }
            });
    });
}

function findBytes(haystack, needle) {
    for (let start = 0; start <= haystack.length - needle.length; start++) {
        let matches = true;
        for (let index = 0; index < needle.length; index++) {
            if (haystack[start + index] !== needle[index]) {
                matches = false;
                break;
            }
        }
        if (matches)
            return start;
    }
    return -1;
}

export class NetBirdDaemonError extends Error {
    constructor(result) {
        const privilege = getPrivilegeError(result.data);
        const message = getErrorMessage(result);
        super(message);

        this.name = 'NetBirdDaemonError';
        this.result = result;
        this.body = result.body;
        this.data = result.data;
        this.method = result.method;
        this.privilegeCommand = privilege?.command ?? '';
        this.privilegeRequired = Boolean(privilege);
        this.privilegeSummary = privilege?.summary ?? '';
        this.socketPath = result.socketPath;
        this.statusCode = result.statusCode;
        this.statusText = result.statusText;
        this.timedOut = result.timedOut;
    }
}

// Test-harness override; unset in normal sessions (tests/api.test.js).
const TEST_SOCKET_PATH = GLib.getenv('NETBIRD_GNOME_TEST_SOCKET');

function getSocketPath() {
    return TEST_SOCKET_PATH || NETBIRD_SOCKET_PATH;
}

function connectAsync(client, address, cancellable) {
    return new Promise((resolve, reject) => {
        client.connect_async(address, cancellable, (source, result) => {
            try {
                resolve(source.connect_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function writeAllAsync(stream, bytes, cancellable) {
    return new Promise((resolve, reject) => {
        stream.write_all_async(
            bytes,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (source, result) => {
                try {
                    source.write_all_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
    });
}

function readHttpResponse(stream, cancellable) {
    let buffer = new Uint8Array(8192);
    let length = 0;
    let scanned = 0;
    let headerEnd = -1;
    let contentLength = null;
    let chunked = false;

    return new Promise((resolve, reject) => {
        function append(bytes) {
            if (length + bytes.length > buffer.length) {
                const grown = new Uint8Array(
                    Math.max(buffer.length * 2, length + bytes.length));
                grown.set(buffer.subarray(0, length));
                buffer = grown;
            }

            buffer.set(bytes, length);
            length += bytes.length;
        }

        function responseBytes() {
            return buffer.subarray(0, length);
        }

        function bodyComplete() {
            if (headerEnd === -1)
                return false;

            const bodyStart = headerEnd + 4;
            if (chunked)
                return chunkedBodyComplete(buffer.subarray(bodyStart, length));

            return contentLength !== null &&
                length - bodyStart >= contentLength;
        }

        function readNext() {
            stream.read_bytes_async(
                4096,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (source, result) => {
                    try {
                        const bytes = source.read_bytes_finish(result);
                        if (bytes.get_size() === 0) {
                            if (headerEnd !== -1 &&
                                (chunked || contentLength !== null) &&
                                !bodyComplete())
                                throw new Error('Truncated NetBird response');

                            resolve(parseResponse(responseBytes()));
                            return;
                        }

                        append(bytes.toArray());
                        if (length > MAX_RESPONSE_BYTES)
                            throw new Error('NetBird response is too large');

                        if (headerEnd === -1) {
                            headerEnd = findHeaderEnd(responseBytes(), scanned);
                            scanned = Math.max(0, length - 3);
                            if (headerEnd !== -1) {
                                const headerText = new TextDecoder().decode(
                                    buffer.subarray(0, headerEnd));
                                const headers = parseHeaders(headerText);
                                contentLength = parseContentLength(headers);
                                chunked = headers
                                    .get('transfer-encoding')
                                    ?.toLowerCase()
                                    .includes('chunked') ?? false;
                            }
                        }

                        if (bodyComplete()) {
                            resolve(parseResponse(responseBytes()));
                            return;
                        }

                        readNext();
                    } catch (error) {
                        reject(error);
                    }
                });
        }

        readNext();
    });
}

function findHeaderEnd(bytes, start = 0) {
    for (let index = start; index <= bytes.length - 4; index++) {
        if (bytes[index] === 13 &&
            bytes[index + 1] === 10 &&
            bytes[index + 2] === 13 &&
            bytes[index + 3] === 10)
            return index;
    }

    return -1;
}

function chunkedBodyComplete(body) {
    let offset = 0;

    while (offset < body.length) {
        const lineEnd = findLineEnd(body, offset);
        if (lineEnd === -1)
            return false;

        const sizeText = new TextDecoder()
            .decode(body.slice(offset, lineEnd))
            .split(';')[0]
            .trim();
        if (!/^[0-9a-f]+$/i.test(sizeText))
            return true;

        const size = Number.parseInt(sizeText, 16);
        offset = lineEnd + 2;
        if (size === 0)
            return findHeaderEnd(body, lineEnd) !== -1;

        if (body.length < offset + size + 2)
            return false;

        offset += size;
        if (body[offset] !== 13 || body[offset + 1] !== 10)
            return true;
        offset += 2;
    }

    return false;
}

function parseResponse(bytes) {
    const headerEnd = findHeaderEnd(bytes);
    if (headerEnd === -1)
        throw new Error('Invalid NetBird HTTP response');

    const decoder = new TextDecoder();
    const headerText = decoder.decode(bytes.slice(0, headerEnd));
    const headers = parseHeaders(headerText);
    const [statusLine] = headerText.split('\r\n');
    const statusMatch = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/);
    if (!statusMatch)
        throw new Error(`Invalid NetBird HTTP status line: ${statusLine}`);

    const bodyBytes = bytes.slice(headerEnd + 4);
    const body = headers
        .get('transfer-encoding')
        ?.toLowerCase()
        .includes('chunked')
        ? decodeChunkedBody(bodyBytes)
        : decoder.decode(bodyBytes);

    return {
        body,
        statusCode: Number(statusMatch[1]),
        statusText: statusMatch[2] || '',
    };
}

function parseHeaders(headerText) {
    const headers = new Map();
    for (const line of headerText.split('\r\n').slice(1)) {
        const separator = line.indexOf(':');
        if (separator === -1)
            continue;

        headers.set(
            line.slice(0, separator).trim().toLowerCase(),
            line.slice(separator + 1).trim());
    }

    return headers;
}

function parseContentLength(headers) {
    const text = headers.get('content-length');
    if (text === undefined)
        return null;
    if (!/^\d+$/.test(text))
        return null;

    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
}

function decodeChunkedBody(body) {
    let offset = 0;
    const chunks = [];

    while (offset < body.length) {
        const lineEnd = findLineEnd(body, offset);
        if (lineEnd === -1)
            throw new Error('Invalid chunked NetBird response');

        const sizeText = new TextDecoder()
            .decode(body.slice(offset, lineEnd))
            .split(';')[0]
            .trim();
        if (!/^[0-9a-f]+$/i.test(sizeText))
            throw new Error('Invalid NetBird HTTP chunk size');

        const size = Number.parseInt(sizeText, 16);
        offset = lineEnd + 2;
        if (size === 0) {
            if (findHeaderEnd(body, lineEnd) === -1)
                throw new Error('Truncated NetBird HTTP chunk terminator');
            break;
        }

        if (offset + size + 2 > body.length)
            throw new Error('Truncated NetBird HTTP chunk');

        chunks.push(body.slice(offset, offset + size));
        if (body[offset + size] !== 13 || body[offset + size + 1] !== 10)
            throw new Error('Invalid NetBird HTTP chunk terminator');
        offset += size + 2;
    }

    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const decoded = new Uint8Array(length);
    let decodedOffset = 0;
    for (const chunk of chunks) {
        decoded.set(chunk, decodedOffset);
        decodedOffset += chunk.length;
    }

    return new TextDecoder().decode(decoded);
}

function findLineEnd(bytes, start) {
    for (let index = start; index < bytes.length - 1; index++) {
        if (bytes[index] === 13 && bytes[index + 1] === 10)
            return index;
    }

    return -1;
}

function parseJsonBody(body) {
    if (!body.trim())
        return {};

    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function getErrorMessage(result) {
    const privilege = getPrivilegeError(result.data);
    if (privilege) {
        return privilege.command
            ? `${privilege.summary}\n\n${privilege.command}`
            : privilege.summary;
    }

    if (typeof result.data?.message === 'string' && result.data.message)
        return result.data.message;

    return result.body?.trim() ||
        result.statusText ||
        `NetBird request failed with HTTP ${result.statusCode}`;
}

function getPrivilegeError(data) {
    if (!Array.isArray(data?.details))
        return null;

    const detail = data.details.find(value =>
        value?.reason === 'PRIVILEGE_REQUIRED' &&
        value?.domain === 'daemon.netbird.io');
    if (!detail)
        return null;

    const summary = String(detail.metadata?.summary ?? data.message ?? '').trim();
    if (!summary)
        return null;

    return {
        command: String(detail.metadata?.command ?? '').trim(),
        summary,
    };
}
