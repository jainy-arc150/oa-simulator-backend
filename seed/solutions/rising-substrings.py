import sys


def main():
    s = sys.stdin.read().split()[0]
    # Only the two end letters matter, so count pairs i < j with s[i] < s[j].
    # count[c] = how many times letter c appeared before the current position.
    count = [0] * 26
    ans = 0
    for ch in s:
        c = ord(ch) - 97
        ans += sum(count[:c])
        count[c] += 1
    print(ans)


main()
