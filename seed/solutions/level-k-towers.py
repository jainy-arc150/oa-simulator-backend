import sys


def main():
    data = sys.stdin.buffer.read().split()
    n, k = int(data[0]), int(data[1])
    h = sorted(map(int, data[2:2 + n]))
    # The best k towers are k neighbours in sorted order, and the best common
    # height is their median. Prefix sums give each window's cost in O(1).
    prefix = [0] * (n + 1)
    for i in range(n):
        prefix[i + 1] = prefix[i] + h[i]
    best = None
    half = (k - 1) // 2
    for l in range(n - k + 1):
        r = l + k - 1
        m = l + half
        med = h[m]
        cost = (med * (m - l) - (prefix[m] - prefix[l])
                + (prefix[r + 1] - prefix[m + 1]) - med * (r - m))
        if best is None or cost < best:
            best = cost
    print(best)


main()
