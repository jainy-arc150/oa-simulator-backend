# MISTAKE: prints the switches that were pressed exactly ONCE. A switch pressed
# an odd number of times (3, 5, ...) also ends on, so those lights are missed.
import sys
from collections import Counter

data = sys.stdin.read().split()
n = int(data[0])
count = Counter(int(x) for x in data[1:1 + n])
on = sorted(x for x, c in count.items() if c == 1)
print(" ".join(map(str, on)) if on else "NONE")
