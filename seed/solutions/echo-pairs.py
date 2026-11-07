import sys


def main():
    data = sys.stdin.buffer.read().split()
    n, k = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    # When we stand at position j, the counter holds every value at a
    # position i <= j - k, so each match is an echo pair ending at j.
    seen = {}
    ans = 0
    for j in range(k, n):
        v = a[j - k]
        seen[v] = seen.get(v, 0) + 1
        ans += seen.get(a[j], 0)
    print(ans)


main()
