import sys

# Compare every pair by cross-multiplying: p1/q1 == p2/q2 exactly when
# p1 * q2 == p2 * q1 (both denominators are non-zero).
data = sys.stdin.read().split()
n = int(data[0])
f = [(int(data[1 + 2 * i]), int(data[2 + 2 * i])) for i in range(n)]
ans = 0
for i in range(n):
    for j in range(i + 1, n):
        if f[i][0] * f[j][1] == f[j][0] * f[i][1]:
            ans += 1
print(ans)
