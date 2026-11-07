# MISTAKE: uses the floating-point square root int(math.sqrt(a)). For large a
# just below a perfect square (for example 10^18 - 1) the float rounds up, so k
# is one too big and the bed's leftover comes out negative.
import math
import sys

data = sys.stdin.read().split()
n = int(data[0])
total = 0
for x in (int(v) for v in data[1:1 + n]):
    k = int(math.sqrt(x))
    total += x - k * k
print(total)
