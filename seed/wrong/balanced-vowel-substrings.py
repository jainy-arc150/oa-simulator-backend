# MISTAKE: the map of prefix keys starts EMPTY instead of holding the empty
# prefix (key (0, 0, 0, 0) seen once). Every balanced substring that starts at
# the first letter is missed (for "b" it prints 0 instead of 1).
import sys

s = sys.stdin.read().split()[0]
vowel = {"a": 0, "e": 1, "i": 2, "o": 3, "u": 4}
count = [0, 0, 0, 0, 0]
seen = {}
ans = 0
for ch in s:
    if ch in vowel:
        count[vowel[ch]] += 1
    a = count[0]
    key = (count[1] - a, count[2] - a, count[3] - a, count[4] - a)
    ans += seen.get(key, 0)
    seen[key] = seen.get(key, 0) + 1
print(ans)
