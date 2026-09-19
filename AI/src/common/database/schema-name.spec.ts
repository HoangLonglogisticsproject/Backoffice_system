import { assertSchemaName, quotedSchema, SCHEMA_NAME_PATTERN } from './schema-name';

describe('schema name validation', () => {
  it.each(['ai', 'ai_itest_runner', '_x', 'a1'])('accepts the plain identifier %s', (name) => {
    expect(assertSchemaName(name)).toBe(name);
    expect(quotedSchema(name)).toBe(`"${name}"`);
  });

  it.each([
    ['a semicolon', 'ai; DROP SCHEMA public CASCADE'],
    ['a comma', 'ai,public'],
    ['a quote', 'ai"'],
    ['a space', 'ai schema'],
    ['a dot', 'ai.public'],
    ['uppercase', 'AI'],
    ['a leading digit', '1ai'],
    ['a dash', 'ai-x'],
    ['empty', ''],
    ['64 characters', 'a'.repeat(64)],
    ['not a string', 42],
    ['undefined', undefined],
  ])('refuses %s', (_label, value) => {
    expect(() => assertSchemaName(value)).toThrow(/Refusing schema name/);
    expect(() => quotedSchema(value)).toThrow(/Refusing schema name/);
  });

  it('pins the pattern the env schema and the runner both use', () => {
    expect(SCHEMA_NAME_PATTERN.source).toBe('^[a-z_][a-z0-9_]{0,62}$');
  });
});
