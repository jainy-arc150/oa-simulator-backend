import sys

# Try every substring and count each vowel in it.
s = sys.stdin.read().split()[0]
n = len(s)
ans = 0
for i in range(n):
    for j in range(i, n):
        sub = s[i:j + 1]
        counts = [sub.count(v) for v in "aeiou"]
        if len(set(counts)) == 1:
            ans += 1
print(ans)
