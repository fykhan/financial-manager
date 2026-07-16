"""Generate an argon2 hash for AUTH_PASSWORD_HASH.

Run locally: python scripts/hash_password.py
The plaintext password is typed at a prompt and never leaves this machine.
"""

from argon2 import PasswordHasher
from getpass import getpass

if __name__ == "__main__":
    password = getpass("Password: ")
    confirm = getpass("Confirm: ")
    if password != confirm:
        raise SystemExit("passwords didn't match")
    print(PasswordHasher().hash(password))
