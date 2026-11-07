# MISTAKE: the current stretch is compared with the best one only when a
# stretch is broken. A longest stretch that runs to the last reading (or an
# array that is calm from start to end, including n = 1) is never counted.
import sys

data = sys.stdin.read().split()
n, d = int(data[0]), int(data[1])
a = [int(x) for x in data[2:2 + n]]
best = 0
cur = 1
for i in range(1, n):
    if abs(a[i] - a[i - 1]) <= d:
        cur += 1
    else:
        best = max(best, cur)
        cur = 1
print(best)
