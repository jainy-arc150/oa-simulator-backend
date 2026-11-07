import sys


def main():
    data = sys.stdin.buffer.read().split()
    n, d = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    best = 1
    cur = 1
    for i in range(1, n):
        if abs(a[i] - a[i - 1]) <= d:
            cur += 1
            if cur > best:
                best = cur
        else:
            cur = 1
    print(best)


main()
