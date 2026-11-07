import sys


def main():
    data = sys.stdin.read().split()
    s, t = data[0], data[1]
    # The first letter fixes the only possible shift.
    k = (ord(t[0]) - ord(s[0])) % 26
    letters = "abcdefghijklmnopqrstuvwxyz"
    table = str.maketrans(letters, letters[k:] + letters[:k])
    print(k if s.translate(table) == t else -1)


main()
