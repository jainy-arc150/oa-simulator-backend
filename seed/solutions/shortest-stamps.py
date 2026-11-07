import sys


def main():
    s = sys.stdin.read().split()[0]
    n = len(s)
    # The shortest stamp of a prefix of length L is L minus the length of its
    # longest proper border (a prefix that is also a suffix). The prefix
    # function gives that border for every prefix in O(n) total.
    pi = [0] * n
    total = 1
    for i in range(1, n):
        j = pi[i - 1]
        while j and s[i] != s[j]:
            j = pi[j - 1]
        if s[i] == s[j]:
            j += 1
        pi[i] = j
        total += i + 1 - j
    print(total)


main()
