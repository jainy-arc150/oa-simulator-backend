import random
import sys

N_MAX = 200000
SMALL_N_MAX = 30
LETTERS = "abcdefghijklmnopqrstuvwxyz"
WRAP_LETTERS = "wxyzab"


def shift(s, k):
    return "".join(LETTERS[(LETTERS.index(c) + k) % 26] for c in s)


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        s = "".join(rng.choice(LETTERS) for _ in range(n))
        t = shift(s, rng.randint(1, 25))
    else:
        n = rng.randint(1, SMALL_N_MAX)
        # Letters near the end of the alphabet make wrap-around common.
        pool = rng.choice([LETTERS, WRAP_LETTERS])
        s = "".join(rng.choice(pool) for _ in range(n))
        t = shift(s, rng.randint(0, 25))
        mode = rng.randint(0, 2)
        if mode == 1:
            # Break the shift at one random position.
            i = rng.randrange(n)
            other = rng.choice([c for c in LETTERS if c != t[i]])
            t = t[:i] + other + t[i + 1:]
        elif mode == 2:
            t = "".join(rng.choice(pool) for _ in range(n))

    print(s)
    print(t)


main()
