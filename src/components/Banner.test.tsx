import { cleanup, fireEvent, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS } from '../theme';
import { Banner, formatBanners, MAX_BANNERS, moreLine, type BannerItem } from './Banner';
import { BUTTON_ICON_SIZE, MIN_TOUCH } from './layout';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function items(n: number): BannerItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i + 1}`,
    text: `Notification ${i + 1}`,
    createdAt: `2025-05-0${i + 1}T09:00:00Z`,
  }));
}

describe('formatBanners (R10.1)', () => {
  it('caps at three', () => {
    expect(MAX_BANNERS).toBe(3);
  });

  it.each([
    [0, 0, 0],
    [1, 1, 0],
    [3, 3, 0],
    [4, 3, 1],
  ])('%d items → %d visible, %d hidden', (n, visible, hidden) => {
    const out = formatBanners(items(n));
    expect(out.visible).toHaveLength(visible);
    expect(out.hidden).toBe(hidden);
  });

  it('orders newest first by createdAt and keeps undated items after, in their order', () => {
    const out = formatBanners([
      { id: 'old', text: 'old', createdAt: '2025-05-01T09:00:00Z' },
      { id: 'u1', text: 'undated 1' },
      { id: 'new', text: 'new', createdAt: '2025-05-03T09:00:00Z' },
      { id: 'u2', text: 'undated 2' },
      { id: 'mid', text: 'mid', createdAt: '2025-05-02T09:00:00Z' },
    ]);
    expect(out.visible.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
    expect(out.hidden).toBe(2);
    expect(
      formatBanners([
        { id: 'u2', text: 'b' },
        { id: 'u1', text: 'a' },
      ]).visible.map((i) => i.id),
    ).toEqual(['u2', 'u1']);
  });

  it('does not change the input', () => {
    const input = items(4);
    const copy = structuredClone(input);
    formatBanners(input);
    expect(input).toEqual(copy);
  });

  it('writes the "and N more" line', () => {
    expect(moreLine(1)).toBe('and 1 more');
    expect(moreLine(2)).toBe('and 2 more');
  });
});

describe('Banner', () => {
  it('draws nothing with no items', () => {
    const { container } = renderThemed(<Banner items={[]} onPress={() => undefined} testID="b" />);
    expect(container.innerHTML).toBe('');
  });

  it.each(SCHEMES)(
    'in %s: one button per visible banner (≥ 48 dp bgMuted card, radius card, no border, brand bell, textPrimary), newest first, then "and 2 more"',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onPress = vi.fn();
      renderThemed(<Banner items={items(5)} onPress={onPress} testID="b" />, scheme);
      const buttons = screen.getAllByRole('button');
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Notification 5',
        'Notification 4',
        'Notification 3',
      ]);
      const face = styleOf(buttons[0]);
      expect(face.minHeight).toBe(MIN_TOUCH);
      expect(tokenNameOf(tokens, face.backgroundColor)).toContain('bgMuted');
      expect(radiusNameOf(tokens, face.borderRadius)).toContain('card');
      expect(face.borderWidth).toBeUndefined();
      const bell = screen.getByTestId('b-n5-icon');
      expect(styleOf(bell)).toMatchObject({ width: BUTTON_ICON_SIZE, height: BUTTON_ICON_SIZE });
      const stroke = styleOf(bell.firstElementChild as Element);
      expect(tokenNameOf(tokens, stroke.borderColor)).toContain('brand');
      expect(tokenNameOf(tokens, styleOf(screen.getByText('Notification 5')).color)).toContain(
        'textPrimary',
      );
      const more = screen.getByTestId('b-more');
      expect(more.textContent).toBe('and 2 more');
      expect(tokenNameOf(tokens, styleOf(more).color)).toContain('textSecondary');

      fireEvent.click(buttons[1]);
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'n4' }));
    },
  );

  it('shows no "more" line when everything fits', () => {
    renderThemed(<Banner items={items(3)} onPress={() => undefined} testID="b" />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByTestId('b-more')).toBeNull();
  });

  it('a tap announces "Notification marked as read" to TalkBack, once, before onPress (R12.9)', () => {
    const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const order: string[] = [];
    announce.mockImplementation(() => {
      order.push('announce');
    });
    const onPress = vi.fn(() => {
      order.push('onPress');
    });
    renderThemed(<Banner items={items(2)} onPress={onPress} testID="b" />);
    expect(announce).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Notification 2' }));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Notification marked as read');
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'n2' }));
    expect(order).toEqual(['announce', 'onPress']);
  });
});
