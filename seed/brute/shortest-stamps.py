import sys

# For every prefix, try every word length p from 1 upwards: repeat the first p
# letters, cut to the prefix length, and compare.
s = sys.stdin.read().split()[0]
n = len(s)
total = 0
for i in range(1, n + 1):
    u = s[:i]
    for p in range(1, i + 1):
        w = u[:p]
        if (w * (i // p + 1))[:i] == u:
            total += p
            break
print(total)
