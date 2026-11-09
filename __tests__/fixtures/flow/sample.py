"""Flow fixture: realistic control flow for the structural invariants."""
import contextlib
import json
from dataclasses import dataclass

LIMIT = 10


def retry(fn, attempts=3, *, delay=0.1, on_error=None):
    last = None
    for i in range(attempts):
        try:
            return fn(i)
        except (OSError, TimeoutError) as e:
            last = e
            if on_error:
                on_error(e)
        except Exception:
            raise
        else:
            break
        finally:
            sleep(delay * (i + 1))
    else:
        raise RuntimeError("exhausted") from last
    return None


def load(path, default=None):
    try:
        with open(path) as fh, contextlib.suppress(KeyError):
            data = json.load(fh)
            if not data:
                return default
            return {k: v for k, v in data.items() if v is not None}
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as err:
        raise ValueError(path) from err


def classify(cmd):
    match cmd:
        case ["go", direction] if direction in ("n", "s"):
            return move(direction)
        case ["stop" | "halt"]:
            return stop()
        case {"op": op, **rest}:
            return run(op, rest)
        case Point(x=0, y=yy):
            return yy
        case str() as s:
            return s
        case _:
            return None


def walk(tree):
    stack = [tree]
    seen = set()
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        for child in node.children:
            if child.skip:
                continue
            stack.append(child)
        else:
            visit(node)
    return seen


def counter():
    total = 0

    def bump(step=1):
        nonlocal total
        total += step
        return total

    def reset():
        global LIMIT
        LIMIT = total

    return bump, reset


async def fetch_all(urls, session):
    results = []
    async with session.lock:
        async for resp in session.stream(urls):
            if (status := resp.status) >= 400:
                results.append(None)
                continue
            results.append(await resp.json())
            if len(results) > LIMIT or not status:
                break
    return results


def gen(items):
    try:
        for it in items:
            got = yield it
            if got is None:
                return
    finally:
        cleanup()


@dataclass
class Box:
    value: int = 0

    def get(self):
        return self.value if self.value >= 0 else -self.value


def pick(a, b, c):
    x = a or b and c
    y = a if b else c
    z = (lambda q: q + x)(y)
    del x
    assert z, "z"
    return [m for m in (a, b, c) if m], z
