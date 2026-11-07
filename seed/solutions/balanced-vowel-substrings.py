import sys


def main():
    s = sys.stdin.read().split()[0]
    vowel = {"a": 0, "e": 1, "i": 2, "o": 3, "u": 4}
    count = [0, 0, 0, 0, 0]
    # A substring is balanced exactly when the prefix before it and the prefix
    # that ends with it have the same differences (e-a, i-a, o-a, u-a).
    key = (0, 0, 0, 0)
    seen = {key: 1}
    ans = 0
    for ch in s:
        v = vowel.get(ch)
        if v is not None:
            count[v] += 1
            a = count[0]
            key = (count[1] - a, count[2] - a, count[3] - a, count[4] - a)
        c = seen.get(key, 0)
        ans += c
        seen[key] = c + 1
    print(ans)


main()
