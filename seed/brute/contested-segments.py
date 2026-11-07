import sys

# Try every segment a[l..r], find its top score and count how often it appears.
data = sys.stdin.read().split()
n = int(data[0])
a = [int(x) for x in data[1:1 + n]]
ans = 0
for l in range(n):
    for r in range(l, n):
        seg = a[l:r + 1]
        top = max(seg)
        if seg.count(top) >= 2:
            ans += 1
print(ans)
