import sys
from bisect import bisect_right


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    s = list(map(int, data[1:1 + 2 * n:2]))
    e = list(map(int, data[2:2 + 2 * n:2]))
    # Two bookings do NOT clash exactly when one ends strictly before the other
    # starts. For each booking, count the bookings that start after it ends.
    starts = sorted(s)
    apart = 0
    for end in e:
        apart += n - bisect_right(starts, end)
    print(n * (n - 1) // 2 - apart)


main()
