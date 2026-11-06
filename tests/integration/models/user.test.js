const User = require('../../../src/models/User');
const { useTestDb, invalidPaths, userData, createUser } = require('../../helpers/factories');

useTestDb();

describe('User model (spec 3.4)', () => {
  test('email is trimmed and lowercased before saving', async () => {
    const user = await createUser({ email: '  Mixed.Case@Example.COM ' });
    expect(user.email).toBe('mixed.case@example.com');
  });

  test('registering the same email twice, in any letter case, is refused by the database', async () => {
    await createUser({ email: 'ann@example.com' });
    await expect(createUser({ email: 'ann@example.com' })).rejects.toMatchObject({ code: 11000 });
    await expect(createUser({ email: 'ANN@Example.com' })).rejects.toMatchObject({ code: 11000 });
    expect(await User.countDocuments()).toBe(1);
  });

  test('the duplicate-key error names the email key, as the error handler expects', async () => {
    await createUser({ email: 'ann@example.com' });
    await expect(createUser({ email: 'ann@example.com' })).rejects.toMatchObject({ keyPattern: { email: 1 } });
  });

  test('passwordHash is never returned by a query unless asked with +passwordHash', async () => {
    await createUser({ email: 'ann@example.com' });
    expect((await User.findOne({ email: 'ann@example.com' })).passwordHash).toBeUndefined();
    expect((await User.find())[0].passwordHash).toBeUndefined();
    expect((await User.findOne().lean()).passwordHash).toBeUndefined();
    expect(JSON.stringify(await User.findOne())).not.toContain('passwordHash');
    expect((await User.findOne().select('+passwordHash')).passwordHash).toBe('not-a-real-hash');
  });

  test('name must be 2 to 50 characters', async () => {
    expect(await invalidPaths(User.create(userData({ name: 'A' })))).toContain('name');
    expect(await invalidPaths(User.create(userData({ name: 'A'.repeat(51) })))).toContain('name');
    await expect(User.create(userData({ name: 'Al' }))).resolves.toBeDefined();
    await expect(User.create(userData({ name: 'A'.repeat(50) }))).resolves.toBeDefined();
  });

  test('name, email and passwordHash are required', async () => {
    const paths = await invalidPaths(User.create({}));
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'passwordHash']));
  });

  test('has createdAt and updatedAt, and the unique email index exists', async () => {
    const user = await createUser();
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    const indexes = await User.collection.indexes();
    expect(indexes.some((i) => i.key.email === 1 && i.unique)).toBe(true);
  });
});
