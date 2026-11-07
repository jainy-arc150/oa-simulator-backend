import sys


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    h = list(map(int, data[1:1 + n]))
    # Python's sort is stable, so equal heights keep increasing person numbers.
    order = sorted(range(n), key=lambda i: -h[i])
    print(" ".join(str(i + 1) for i in order))


main()
