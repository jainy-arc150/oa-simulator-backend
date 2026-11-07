import sys

# Try every stretch a[l..r] and check every neighbour pair inside it.
data = sys.stdin.read().split()
n, d = int(data[0]), int(data[1])
a = [int(x) for x in data[2:2 + n]]
best = 0
for l in range(n):
    for r in range(l, n):
        calm = True
        for i in range(l, r):
            if abs(a[i] - a[i + 1]) > d:
                calm = False
        if calm and r - l + 1 > best:
            best = r - l + 1
print(best)
