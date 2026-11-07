import random
import sys

N_MAX = 200000
SMALL_N_MAX = 30
VOWELS = "aeiou"
LETTERS = "abcdefghijklmnopqrstuvwxyz"
CONSONANTS = "bcdfghjklmnpqrstvwxyz"
CONSONANT_CHANCE = 0.2


def blocks(rng, n):
    # Shuffled copies of aeiou with consonants mixed in: many balanced substrings.
    out = []
    while len(out) < n:
        if rng.random() < CONSONANT_CHANCE:
            out.append(rng.choice(CONSONANTS))
        else:
            block = list(VOWELS)
            rng.shuffle(block)
            out.extend(block)
    return "".join(out[:n])


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        s = blocks(rng, N_MAX)
    else:
        n = rng.randint(1, SMALL_N_MAX)
        profile = rng.randint(0, 3)
        if profile == 0:
            s = blocks(rng, n)
        elif profile == 1:
            s = "".join(rng.choice(VOWELS) for _ in range(n))
        elif profile == 2:
            s = "".join(rng.choice(VOWELS + "xy") for _ in range(n))
        else:
            s = "".join(rng.choice(LETTERS) for _ in range(n))
    print(s)


main()
