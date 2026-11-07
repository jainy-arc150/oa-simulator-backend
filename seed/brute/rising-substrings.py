import sys

# Try every substring with at least two letters.
s = sys.stdin.read().split()[0]
n = len(s)
ans = 0
for i in range(n):
    for j in range(i + 1, n):
        sub = s[i:j + 1]
        if sub[0] < sub[-1]:
            ans += 1
print(ans)
