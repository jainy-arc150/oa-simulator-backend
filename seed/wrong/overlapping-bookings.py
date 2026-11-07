# MISTAKE: uses bisect_left instead of bisect_right, so a booking that starts
# exactly when another ends is treated as NOT clashing. Bookings that touch at
# one moment (like [1, 3] and [3, 5]) are missed, and a booking with s = e is
# even counted as apart from itself.
import sys
from bisect import bisect_left

data = sys.stdin.read().split()
n = int(data[0])
s = [int(data[1 + 2 * i]) for i in range(n)]
e = [int(data[2 + 2 * i]) for i in range(n)]
starts = sorted(s)
apart = 0
for end in e:
    apart += n - bisect_left(starts, end)
print(n * (n - 1) // 2 - apart)
