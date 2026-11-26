/**
 * The field rules the account screens apply before anything is sent (worker-app R1.2, R1.4; design
 * "Error Handling": "app first, server second"). Each rule is the twin of the one the backend's
 * `AuthValidator` applies, so the phone shows the same refusal the server would, without a round
 * trip:
 *
 * | Field    | Rule                                                             | Backend                        |
 * | -------- | ---------------------------------------------------------------- | ------------------------------ |
 * | name     | 2–100 characters after trimming                                  | `AuthValidator.validateName`   |
 * | email    | one `@` with text on both sides and a dot in the domain          | `StringUtils.hasText` + Spring |
 * | password | at least 8 characters                                            | `password.length() < 8`        |
 * | phone    | `normalisePhone` accepts it (10 digits, or `91` + 10)            | `PhoneNumbers.normalise`       |
 *
 * Every function answers the id of the sentence to show under the field (`strings.en.ts`,
 * `validation.*`), or `null` when the value passes. The screens call `t(id)`; nothing here holds
 * text. Pure: no React, no Expo.
 */
import { normalisePhone } from '@stockkart/attendance-protocol';

import type { StringId } from '../i18n';

/** `AuthValidator.NAME_MIN` / `NAME_MAX`: a worker's full name after trimming (R1.2). */
export const NAME_MIN = 2;
export const NAME_MAX = 100;

/** `AuthValidator`: "Password must be at least 8 characters long". */
export const PASSWORD_MIN = 8;

/** Something before `@`, something after it, and a dot in the domain; no whitespace anywhere. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A validation answer: the id of the sentence under the field, or `null` when the value passes. */
export type FieldError = StringId | null;

export function validateName(raw: string): FieldError {
  const name = raw.trim();
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? null : 'validation.name';
}

export function validateEmail(raw: string): FieldError {
  return EMAIL.test(raw.trim()) ? null : 'validation.email';
}

export function validatePassword(raw: string): FieldError {
  return raw.length >= PASSWORD_MIN ? null : 'validation.password';
}

export function validatePhone(raw: string): FieldError {
  return normalisePhone(raw) === null ? 'validation.phone' : null;
}

// --- forms ---

export interface SignInFields {
  email: string;
  password: string;
}

export interface CreateAccountFields extends SignInFields {
  name: string;
  phone: string;
}

/** Errors per field of the Sign in form; `{}` when it may be sent. */
export function signInErrors(fields: SignInFields): Partial<Record<keyof SignInFields, StringId>> {
  return compact({
    email: validateEmail(fields.email),
    // Sign in asks only that a password was typed; the server decides whether it is right.
    password: fields.password.length > 0 ? null : 'validation.password',
  });
}

/** Errors per field of the Create account form; `{}` when it may be sent (R1.2). */
export function createAccountErrors(
  fields: CreateAccountFields,
): Partial<Record<keyof CreateAccountFields, StringId>> {
  return compact({
    name: validateName(fields.name),
    email: validateEmail(fields.email),
    password: validatePassword(fields.password),
    phone: validatePhone(fields.phone),
  });
}

/** The trimmed values a form sends: name and e-mail trimmed, the password as typed, the phone as typed. */
export function trimmedFields<T extends Partial<CreateAccountFields>>(fields: T): T {
  const out = { ...fields };
  if (typeof out.name === 'string') {
    out.name = out.name.trim();
  }
  if (typeof out.email === 'string') {
    out.email = out.email.trim();
  }
  if (typeof out.phone === 'string') {
    out.phone = out.phone.trim();
  }
  return out;
}

function compact<K extends string>(errors: Record<K, FieldError>): Partial<Record<K, StringId>> {
  const out: Partial<Record<K, StringId>> = {};
  for (const key of Object.keys(errors) as K[]) {
    const error = errors[key];
    if (error !== null) {
      out[key] = error;
    }
  }
  return out;
}
