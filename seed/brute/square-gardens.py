import sys

# For each bed, find the largest k with k * k <= a by a plain binary search on
# whole numbers (k is at most 10^9 because a is at most 10^18).
K_HIGH = 2 * 10 ** 9

data = sys.stdin.read().split()
n = int(data[0])
total = 0
for x in (int(v) for v in data[1:1 + n]):
    lo, hi = 0, K_HIGH
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if mid * mid <= x:
            lo = mid
        else:
            hi = mid - 1
    total += x - lo * lo
print(total)
