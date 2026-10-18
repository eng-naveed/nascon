"""Makes http://localhost:8080 (and the media ports) inside a Selenium browser node reach the real services.

The spec's Selenium Test 1 browses http://localhost:8080/q/m1-live from inside the Grid. In a node container
"localhost" is the node itself, so this tiny TCP relay (stdlib only; the node image ships python3) forwards
the node's loopback ports to the compose services before the node starts.
"""
import asyncio
import os
import socket

ROUTES = {
    8080: (os.environ.get("NASCON_API_HOST", "backend"), 8080),
    8888: (os.environ.get("NASCON_MEDIA_HOST", "mediamtx"), 8888),
    8889: (os.environ.get("NASCON_MEDIA_HOST", "mediamtx"), 8889),
}


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        writer.close()


def handler(target):
    async def handle(client_r: asyncio.StreamReader, client_w: asyncio.StreamWriter) -> None:
        try:
            up_r, up_w = await asyncio.open_connection(*target)
        except OSError:
            client_w.close()
            return
        await asyncio.gather(pipe(client_r, up_w), pipe(up_r, client_w))

    return handle


async def main() -> None:
    servers = []
    for port, target in ROUTES.items():
        for host in ("127.0.0.1", "::1"):  # browsers may try either loopback family for "localhost"
            try:
                servers.append(await asyncio.start_server(handler(target), host, port, family=socket.AF_INET6 if ":" in host else socket.AF_INET))
            except OSError:
                pass
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == "__main__":
    asyncio.run(main())
