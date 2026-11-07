import sys


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    on = set()
    for b in map(int, data[1:1 + n]):
        if b in on:
            on.remove(b)
        else:
            on.add(b)
    result = sorted(on)
    print(" ".join(map(str, result)) if result else "NONE")


main()
