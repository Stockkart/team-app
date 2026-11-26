import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contentStyleOf, fontScalingOf, styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TEXT_SCALING, TOKENS, typeScale } from '../theme';
import { talkbackLabel } from './a11y';
import { AppText } from './AppText';
import { Avatar, initialOf } from './Avatar';
import { Banner } from './Banner';
import { Chip } from './Chip';
import { ConfirmSheet } from './ConfirmSheet';
import { DangerButton } from './DangerButton';
import { EmptyState } from './EmptyState';
import { FormField, labelFloats } from './FormField';
import { GradientHeader } from './GradientHeader';
import { Icon, ICON_NAMES } from './Icon';
import { INPUT_HEIGHT, SCREEN_PADDING, STATUS_ICON_CIRCLE, STATUS_ICON_SIZE } from './layout';
import { ModuleTile } from './ModuleTile';
import { PrimaryButton } from './PrimaryButton';
import { Screen } from './Screen';
import { SecondaryButton } from './SecondaryButton';
import { StatusCard, statusCardLabel } from './StatusCard';

// `Screen` reads the safe area from react-native-safe-area-context, a native module.
const insets = vi.hoisted(() => ({ top: 24, bottom: 16, left: 0, right: 0 }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => insets }));

afterEach(cleanup);

const noop = () => undefined;

/** Every component of the kit, with the TalkBack name each must expose. */
const KIT: ReadonlyArray<{ name: string; element: ReactElement; role: string; label: string }> = [
  {
    name: 'PrimaryButton',
    element: <PrimaryButton label="Find shop" onPress={noop} />,
    role: 'button',
    label: 'Find shop',
  },
  {
    name: 'SecondaryButton',
    element: <SecondaryButton label="Not my shop" onPress={noop} />,
    role: 'button',
    label: 'Not my shop',
  },
  {
    name: 'DangerButton',
    element: (
      <DangerButton label="Log out" question="Log out?" cancelLabel="Cancel" onConfirm={noop} />
    ),
    role: 'button',
    label: 'Log out',
  },
  {
    name: 'ConfirmSheet',
    element: (
      <ConfirmSheet
        visible
        question="Withdraw your request?"
        confirmLabel="Withdraw"
        cancelLabel="Cancel"
        onConfirm={noop}
        onCancel={noop}
      />
    ),
    role: 'heading',
    label: 'Withdraw your request?',
  },
  {
    name: 'StatusCard',
    element: <StatusCard title="Waiting" line="Waiting for Sri Ganesh Stores to accept you" />,
    role: 'summary',
    label: 'Waiting. Waiting for Sri Ganesh Stores to accept you',
  },
  {
    name: 'ModuleTile',
    element: <ModuleTile icon="person" label="Profile" size="half" onPress={noop} />,
    role: 'button',
    label: 'Profile',
  },
  {
    name: 'EmptyState',
    element: <EmptyState sentence="No check-ins yet." />,
    role: 'summary',
    label: 'No check-ins yet.',
  },
  {
    name: 'Banner',
    element: (
      <Banner items={[{ id: 'a', text: 'Sri Ganesh Stores accepted you' }]} onPress={noop} />
    ),
    role: 'button',
    label: 'Sri Ganesh Stores accepted you',
  },
  {
    name: 'FormField',
    element: <FormField label="Shop owner's email" value="" onChangeText={noop} />,
    role: 'textbox',
    label: "Shop owner's email",
  },
  {
    name: 'Avatar (initial)',
    element: <Avatar name="Priya Sharma" size={48} />,
    role: 'image',
    label: 'Priya Sharma',
  },
  {
    name: 'Avatar (photo)',
    element: (
      <Avatar name="Priya Sharma" size={48} uri="https://api.test.invalid/api/v1/users/u1/photo" />
    ),
    role: 'image',
    label: 'Priya Sharma',
  },
  {
    name: 'Screen',
    element: (
      <Screen title="Join a shop" footer={<PrimaryButton label="Find shop" onPress={noop} />}>
        <AppText>Body</AppText>
      </Screen>
    ),
    role: 'heading',
    label: 'Join a shop',
  },
  {
    name: 'Chip',
    element: <Chip label="Inside shop" icon="check" tone="success" />,
    role: 'text',
    label: 'Inside shop',
  },
  {
    name: 'GradientHeader',
    element: (
      <GradientHeader>
        <AppText variant="title" accessibilityRole="header">
          Good morning, Ramesh
        </AppText>
      </GradientHeader>
    ),
    role: 'heading',
    label: 'Good morning, Ramesh',
  },
];

describe('the component kit renders in both themes with a role and a label (R12.9)', () => {
  for (const scheme of SCHEMES) {
    describe(scheme, () => {
      it.each(KIT.map((k) => [k.name, k] as const))('%s', (_name, kit) => {
        renderThemed(kit.element, scheme);
        const element =
          kit.role === 'textbox'
            ? screen.getByLabelText(kit.label)
            : screen.getByRole(kit.role, { name: kit.label });
        expect(element).toBeTruthy();
      });
    });
  }

  it('every Text carries TEXT_SCALING (R12.2)', () => {
    const { container } = renderThemed(
      <>
        {KIT.filter((k) => k.name !== 'Screen').map((k) => (
          <div key={k.name}>{k.element}</div>
        ))}
      </>,
    );
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans.length).toBeGreaterThan(5);
    for (const span of spans) {
      expect(fontScalingOf(span)).toEqual(TEXT_SCALING);
    }
  });
});

describe('AppText', () => {
  it.each(SCHEMES)('in %s: type role sizes and the colour token of that theme', (scheme) => {
    renderThemed(
      <AppText variant="title" color="textSecondary" testID="t">
        Hello
      </AppText>,
      scheme,
    );
    const style = styleOf(screen.getByTestId('t'));
    expect(style.fontSize).toBe(typeScale.title.fontSize);
    expect(style.lineHeight).toBe(typeScale.title.lineHeight);
    expect(style.fontFamily).toBe(typeScale.title.fontFamily);
    expect(style.color).toBe(TOKENS[scheme].color.textSecondary);
  });

  it('defaults to body in textPrimary', () => {
    renderThemed(<AppText testID="t">Hello</AppText>);
    const style = styleOf(screen.getByTestId('t'));
    expect(style.fontSize).toBe(16);
    expect(style.color).toBe(TOKENS.light.color.textPrimary);
  });
});

describe('Screen', () => {
  it.each(SCHEMES)(
    'in %s: bgCanvas, safe area + 16 dp padding, title as header, footer pinned',
    (scheme) => {
      renderThemed(
        <Screen
          title="Join a shop"
          footer={<PrimaryButton label="Find shop" onPress={noop} />}
          testID="s"
        >
          <AppText>Body</AppText>
        </Screen>,
        scheme,
      );
      const root = screen.getByTestId('s');
      expect(tokenNameOf(TOKENS[scheme], styleOf(root).backgroundColor)).toContain('bgCanvas');
      const body = root.firstElementChild as Element;
      expect(styleOf(body).paddingTop).toBe(insets.top + SCREEN_PADDING);
      expect(styleOf(body).paddingLeft).toBe(SCREEN_PADDING);
      expect(screen.getByRole('heading', { name: 'Join a shop' })).toBeTruthy();
      const footer = screen.getByTestId('s-footer');
      expect(styleOf(footer).paddingBottom).toBe(insets.bottom + SCREEN_PADDING);
      expect(footer.querySelector('[aria-label="Find shop"]')).not.toBeNull();
      expect(screen.getByText('Body')).toBeTruthy();
    },
  );

  it('without a title or footer it draws neither', () => {
    renderThemed(
      <Screen scroll testID="s">
        <AppText>Body</AppText>
      </Screen>,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByTestId('s-footer')).toBeNull();
  });

  it('a header is drawn full-bleed above the padded body, which then keeps only the 16 dp padding (the band carries the inset)', () => {
    renderThemed(
      <Screen scroll header={<View testID="band" />} testID="s">
        <AppText>Body</AppText>
      </Screen>,
    );
    const band = screen.getByTestId('band');
    const body = screen.getByTestId('s-body');
    expect(band.nextElementSibling).toBe(body);
    expect(styleOf(band).paddingLeft).toBeUndefined();
    expect(styleOf(body).paddingTop).toBe(SCREEN_PADDING);
    expect(styleOf(body).paddingLeft).toBe(SCREEN_PADDING);
    // The scrolling content fills the viewport so a child may centre itself with flex: 1.
    expect(contentStyleOf(band.parentElement as Element).flexGrow).toBe(1);
  });
});

describe('StatusCard (R12.15)', () => {
  it.each([
    ['neutral', 'bgElevated', 'brand', 'brandSoft'],
    ['success', 'successSoft', 'success', 'bgElevated'],
    ['warning', 'warningSoft', 'warning', 'bgElevated'],
    ['danger', 'dangerSoft', 'danger', 'bgElevated'],
  ] as const)(
    'tone %s: card %s, icon in %s on a 40 dp %s circle, title textPrimary, line textSecondary',
    (tone, tint, iconColor, circleColor) => {
      for (const scheme of SCHEMES) {
        const tokens = TOKENS[scheme];
        renderThemed(<StatusCard title="Title" line="Line" tone={tone} testID="c" />, scheme);
        const card = styleOf(screen.getByTestId('c'));
        expect(tokenNameOf(tokens, card.backgroundColor)).toContain(tint);
        expect(radiusNameOf(tokens, card.borderRadius)).toContain('card');
        // No border in light; a 1 dp decorative edge in dark.
        if (scheme === 'light') {
          expect(card.borderWidth).toBe(0);
        } else {
          expect(card.borderWidth).toBe(1);
          expect(tokenNameOf(tokens, card.borderColor)).toContain('borderDefault');
        }
        const circle = screen.getByTestId('c-icon-circle');
        expect(styleOf(circle)).toMatchObject({
          width: STATUS_ICON_CIRCLE,
          height: STATUS_ICON_CIRCLE,
          borderRadius: STATUS_ICON_CIRCLE / 2,
        });
        expect(tokenNameOf(tokens, styleOf(circle).backgroundColor)).toContain(circleColor);
        const icon = screen.getByTestId('c-icon');
        expect(styleOf(icon)).toMatchObject({ width: STATUS_ICON_SIZE, height: STATUS_ICON_SIZE });
        expect(icon.children.length).toBeGreaterThan(0);
        // The glyph is painted in the tone colour (its first stroke names it).
        const stroke = styleOf(icon.firstElementChild as Element);
        expect(tokenNameOf(tokens, stroke.borderColor ?? stroke.backgroundColor)).toContain(
          iconColor,
        );
        expect(tokenNameOf(tokens, styleOf(screen.getByText('Title')).color)).toContain(
          'textPrimary',
        );
        expect(tokenNameOf(tokens, styleOf(screen.getByText('Line')).color)).toContain(
          'textSecondary',
        );
        cleanup();
      }
    },
  );

  it('takes an explicit icon instead of the tone default', () => {
    renderThemed(<StatusCard title="Waiting" tone="warning" icon="history" testID="c" />);
    // `history` is the clock face: a ring and two hands (3 children); the warning glyph has 3 too,
    // so tell them apart by the minute hand, a horizontal bar.
    const children = Array.from(screen.getByTestId('c-icon').children).map((c) => styleOf(c));
    expect(children.some((c) => typeof c.width === 'number' && c.height === 2)).toBe(true);
  });

  it('keeps the action a separate control outside the summary element', () => {
    const onPress = vi.fn();
    renderThemed(
      <StatusCard
        title="Enable biometric check-in."
        line="Ask your manager for a code."
        action={<PrimaryButton label="I have a code" onPress={onPress} />}
      />,
    );
    const summary = screen.getByRole('summary');
    expect(summary.getAttribute('aria-label')).toBe(
      'Enable biometric check-in. Ask your manager for a code.',
    );
    const button = screen.getByRole('button', { name: 'I have a code' });
    expect(summary.contains(button)).toBe(false);
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('statusCardLabel joins title and line', () => {
    expect(statusCardLabel('A')).toBe('A');
    expect(statusCardLabel('A', 'B')).toBe('A. B');
  });
});

describe('talkbackLabel (R12.9)', () => {
  it.each([
    [['Attendance', 'Not checked in'], 'Attendance. Not checked in'],
    [
      ['Enable biometric check-in.', 'Ask your manager for a code.'],
      'Enable biometric check-in. Ask your manager for a code.',
    ],
    [['Waiting?', 'Yes'], 'Waiting? Yes'],
    [['Only'], 'Only'],
    [['A', undefined, '', 'B'], 'A. B'],
    [[undefined, ''], ''],
  ])('%j → %j', (parts, want) => {
    expect(talkbackLabel(...parts)).toBe(want);
  });
});

describe('EmptyState (R12.6)', () => {
  it('one sentence in secondary, and one secondary button only when an action is given', () => {
    const onPress = vi.fn();
    renderThemed(<EmptyState sentence="No notifications." />);
    expect(screen.queryByRole('button')).toBeNull();
    const sentence = styleOf(screen.getByText('No notifications.'));
    expect(sentence.fontSize).toBe(typeScale.secondary.fontSize);
    expect(tokenNameOf(TOKENS.light, sentence.color)).toContain('textSecondary');
    cleanup();

    renderThemed(
      <EmptyState sentence="Not checked in" action={{ label: 'I have a code', onPress }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'I have a code' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('FormField (R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: a 56 dp input on bgElevated, radius field, 1 dp borderStrong, labelled for TalkBack, helper under it',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onChangeText = vi.fn();
      renderThemed(
        <FormField
          label="Phone number"
          value="98765"
          helper="We'll use this number for your shop to contact you"
          keyboardType="phone-pad"
          onChangeText={onChangeText}
          testID="f"
        />,
        scheme,
      );
      const input = screen.getByLabelText('Phone number');
      const style = styleOf(input);
      expect(style.minHeight).toBe(INPUT_HEIGHT);
      expect(radiusNameOf(tokens, style.borderRadius)).toContain('field');
      expect(style.borderWidth).toBe(1);
      expect(tokenNameOf(tokens, style.borderColor)).toContain('borderStrong');
      expect(tokenNameOf(tokens, style.backgroundColor)).toContain('bgElevated');
      expect(tokenNameOf(tokens, style.color)).toContain('textPrimary');
      expect(fontScalingOf(input)).toEqual(TEXT_SCALING);
      expect(input.getAttribute('data-hint')).toBe(
        "We'll use this number for your shop to contact you",
      );
      const helper = screen.getByTestId('f-helper');
      expect(tokenNameOf(tokens, styleOf(helper).color)).toContain('textSecondary');
      fireEvent.change(input, { target: { value: '9876543210' } });
      expect(onChangeText).toHaveBeenCalledWith('9876543210');
    },
  );

  it('the label rests inside an empty, unfocused field and floats into the top edge once focused or filled', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderThemed(
      <FormField
        label="Email"
        value=""
        placeholder="you@example.com"
        onChangeText={noop}
        onFocus={onFocus}
        onBlur={onBlur}
        testID="f"
      />,
    );
    const input = screen.getByLabelText('Email');
    const label = () => screen.getByTestId('f-label');
    const labelText = () => screen.getByText('Email');
    // Resting: body-sized label in textSecondary, placeholder hidden so the two never overlap.
    expect(styleOf(label()).top).toBeGreaterThan(0);
    expect(styleOf(labelText()).fontSize).toBe(typeScale.body.fontSize);
    expect(tokenNameOf(TOKENS.light, styleOf(labelText()).color)).toContain('textSecondary');
    expect(input.getAttribute('placeholder')).toBeNull();
    expect(label().getAttribute('aria-label')).toBeNull();

    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    // Floating: secondary-sized, above the top edge on a bgElevated patch that cuts the outline.
    expect(styleOf(label()).top).toBeLessThan(0);
    expect(tokenNameOf(TOKENS.light, styleOf(label()).backgroundColor)).toContain('bgElevated');
    expect(styleOf(labelText()).fontSize).toBe(typeScale.secondary.fontSize);
    expect(input.getAttribute('placeholder')).toBe('you@example.com');
    // Focused outline: 2 dp brand.
    expect(styleOf(input).borderWidth).toBe(2);
    expect(tokenNameOf(TOKENS.light, styleOf(input).borderColor)).toContain('brand');

    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(styleOf(label()).top).toBeGreaterThan(0);
    expect(styleOf(input).borderWidth).toBe(1);
    expect(tokenNameOf(TOKENS.light, styleOf(input).borderColor)).toContain('borderStrong');
  });

  it('a filled field keeps its label floated without focus', () => {
    renderThemed(<FormField label="Email" value="a@b.in" onChangeText={noop} testID="f" />);
    expect(styleOf(screen.getByTestId('f-label')).top).toBeLessThan(0);
  });

  it.each([
    [false, undefined, false],
    [false, '', false],
    [true, '', true],
    [false, 'x', true],
    [true, 'x', true],
  ])('labelFloats(%s, %j) is %s', (focused, value, want) => {
    expect(labelFloats(focused, value)).toBe(want);
  });

  it('an error replaces the helper, is read live, and turns the outline 2 dp danger', () => {
    renderThemed(
      <FormField
        label="Phone number"
        value=""
        helper="Helper"
        error="Enter a 10-digit mobile number."
        onChangeText={noop}
        testID="f"
      />,
    );
    const input = screen.getByLabelText('Phone number');
    expect(styleOf(input).borderWidth).toBe(2);
    expect(tokenNameOf(TOKENS.light, styleOf(input).borderColor)).toContain('danger');
    expect(input.getAttribute('data-hint')).toBe('Enter a 10-digit mobile number.');
    const error = screen.getByTestId('f-error');
    expect(error.textContent).toBe('Enter a 10-digit mobile number.');
    expect(error.getAttribute('aria-live')).toBe('polite');
    expect(tokenNameOf(TOKENS.light, styleOf(error).color)).toContain('danger');
    expect(screen.queryByTestId('f-helper')).toBeNull();
  });

  it('editable=false disables the input and says so', () => {
    renderThemed(<FormField label="Email" value="a@b.in" editable={false} onChangeText={noop} />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveProperty('disabled', true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Avatar (R11.5)', () => {
  it('loads the photo with the request headers it is given, never bare', () => {
    renderThemed(
      <Avatar
        name="Priya Sharma"
        size={64}
        uri="https://api.test.invalid/api/v1/users/u1/photo"
        headers={{ Authorization: 'Bearer t0ken' }}
        testID="a"
      />,
    );
    const img = screen.getByRole('image', { name: 'Priya Sharma' });
    expect(img.getAttribute('src')).toBe('https://api.test.invalid/api/v1/users/u1/photo');
    expect(JSON.parse(img.getAttribute('data-headers') ?? '{}')).toEqual({
      Authorization: 'Bearer t0ken',
    });
    expect(styleOf(img)).toMatchObject({ width: 64, height: 64, borderRadius: 32 });
  });

  it.each(SCHEMES)(
    'in %s: without a photo, the initial on a brand disc in textInverse',
    (scheme) => {
      renderThemed(<Avatar name="priya sharma" size={40} testID="a" />, scheme);
      const disc = screen.getByRole('image', { name: 'priya sharma' });
      expect(tokenNameOf(TOKENS[scheme], styleOf(disc).backgroundColor)).toContain('brand');
      expect(styleOf(disc)).toMatchObject({ width: 40, height: 40, borderRadius: 20 });
      expect(screen.getByText('P')).toBeTruthy();
      expect(tokenNameOf(TOKENS[scheme], styleOf(screen.getByText('P')).color)).toContain(
        'textInverse',
      );
    },
  );

  it.each(SCHEMES)('in %s: the onSoft variant draws a brand initial on brandSoft', (scheme) => {
    renderThemed(<Avatar name="Ramesh" size={56} variant="onSoft" testID="a" />, scheme);
    const disc = screen.getByRole('image', { name: 'Ramesh' });
    expect(tokenNameOf(TOKENS[scheme], styleOf(disc).backgroundColor)).toContain('brandSoft');
    expect(styleOf(disc)).toMatchObject({ width: 56, height: 56, borderRadius: 28 });
    expect(tokenNameOf(TOKENS[scheme], styleOf(screen.getByText('R')).color)).toContain('brand');
  });

  it.each([
    ['Priya Sharma', 'P'],
    ['  ravi', 'R'],
    ['', '?'],
    ['   ', '?'],
    ['ಅನಿಲ್', 'ಅ'],
  ])('initialOf(%j) is %j', (name, want) => {
    expect(initialOf(name)).toBe(want);
  });
});

describe('Icon', () => {
  it('has the module glyphs and the ones the cards, chips, banners, rows and the photo picker lead with', () => {
    expect(ICON_NAMES).toEqual([
      'fingerprint',
      'history',
      'person',
      'unknown',
      'bell',
      'info',
      'check',
      'warning',
      'cross',
      'store',
      'hourglass',
      'camera',
      'chevron',
      'document',
      'lock',
      'arrowIn',
      'arrowOut',
    ]);
  });

  it.each(ICON_NAMES)('%s draws a brand glyph hidden from TalkBack at the size asked', (name) => {
    renderThemed(<Icon name={name} size={28} testID="i" />);
    const icon = screen.getByTestId('i');
    expect(styleOf(icon)).toMatchObject({ width: 28, height: 28 });
    expect(icon.getAttribute('aria-label')).toBeNull();
    expect(icon.children.length).toBeGreaterThan(0);
    for (const part of Array.from(icon.children)) {
      const style = styleOf(part);
      const paint = style.borderColor ?? style.backgroundColor;
      expect(tokenNameOf(TOKENS.light, paint)).toContain('brand');
    }
  });

  it('paints every stroke in the colour token asked', () => {
    renderThemed(<Icon name="bell" size={20} color="success" testID="i" />);
    for (const part of Array.from(screen.getByTestId('i').children)) {
      const style = styleOf(part);
      expect(tokenNameOf(TOKENS.light, style.borderColor ?? style.backgroundColor)).toContain(
        'success',
      );
    }
  });
});
