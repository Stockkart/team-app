import { describe, expect, it } from 'vitest';

import {
  NAME_MAX,
  NAME_MIN,
  PASSWORD_MIN,
  createAccountErrors,
  signInErrors,
  trimmedFields,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} from './validation';

describe('field rules, twins of the backend AuthValidator (R1.2)', () => {
  it('name: 2–100 characters after trimming', () => {
    expect(validateName('Priya Sharma')).toBeNull();
    expect(validateName('  Pr  ')).toBeNull();
    expect(validateName('a'.repeat(NAME_MAX))).toBeNull();
    expect(validateName('P')).toBe('validation.name');
    expect(validateName('   ')).toBe('validation.name');
    expect(validateName('a'.repeat(NAME_MAX + 1))).toBe('validation.name');
    expect(NAME_MIN).toBe(2);
  });

  it('email: text @ text . text, no whitespace', () => {
    expect(validateEmail('priya@example.in')).toBeNull();
    expect(validateEmail('  priya@example.in  ')).toBeNull();
    expect(validateEmail('priya')).toBe('validation.email');
    expect(validateEmail('priya@example')).toBe('validation.email');
    expect(validateEmail('pri ya@example.in')).toBe('validation.email');
    expect(validateEmail('')).toBe('validation.email');
  });

  it('password: at least 8 characters, as the server says', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN))).toBeNull();
    expect(validatePassword('a'.repeat(PASSWORD_MIN - 1))).toBe('validation.password');
    expect(validatePassword('')).toBe('validation.password');
  });

  it('phone: normalisePhone accepts it (10 digits, +91 and spaces stripped)', () => {
    expect(validatePhone('9876543210')).toBeNull();
    expect(validatePhone('+91 98765 43210')).toBeNull();
    expect(validatePhone('098765 43210')).toBe('validation.phone');
    expect(validatePhone('98765')).toBe('validation.phone');
    expect(validatePhone('')).toBe('validation.phone');
  });
});

describe('form checks', () => {
  it('createAccountErrors names every failing field and nothing else', () => {
    expect(
      createAccountErrors({
        name: 'Priya Sharma',
        email: 'priya@example.in',
        password: 'longenough',
        phone: '9876543210',
      }),
    ).toEqual({});
    expect(
      createAccountErrors({ name: 'P', email: 'nope', password: 'short', phone: '12' }),
    ).toEqual({
      name: 'validation.name',
      email: 'validation.email',
      password: 'validation.password',
      phone: 'validation.phone',
    });
  });

  it('signInErrors asks for an e-mail shape and a typed password only', () => {
    expect(signInErrors({ email: 'priya@example.in', password: 'x' })).toEqual({});
    expect(signInErrors({ email: 'priya', password: '' })).toEqual({
      email: 'validation.email',
      password: 'validation.password',
    });
  });

  it('trimmedFields trims name, e-mail and phone and leaves the password as typed', () => {
    expect(
      trimmedFields({ name: ' Priya ', email: ' p@e.in ', password: ' pw ', phone: ' 98 ' }),
    ).toEqual({ name: 'Priya', email: 'p@e.in', password: ' pw ', phone: '98' });
  });
});
