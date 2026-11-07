import sys

# Try every pair of positions i < j.
data = sys.stdin.read().split()
n, k = int(data[0]), int(data[1])
a = [int(x) for x in data[2:2 + n]]
ans = 0
for i in range(n):
    for j in range(i + 1, n):
        if a[i] == a[j] and j - i >= k:
            ans += 1
print(ans)
