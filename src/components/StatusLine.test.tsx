import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessibilityInfo, styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { tokenNameOf } from '../../test-support/tokens';
import { TOKENS, typeScale } from '../theme';
import { StatusLine } from './StatusLine';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StatusLine (R7.11, R12.9)', () => {
  it.each(SCHEMES)('in %s: body text in textPrimary, a polite live region', (scheme) => {
    const tokens = TOKENS[scheme];
    renderThemed(<StatusLine text="Not checked in yet" testID="line" />, scheme);
    const line = screen.getByTestId('line');
    expect(line.textContent).toBe('Not checked in yet');
    expect(styleOf(line).fontSize).toBe(typeScale.body.fontSize);
    expect(tokenNameOf(tokens, styleOf(line).color)).toContain('textPrimary');
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(line.getAttribute('data-number-of-lines')).toBeNull();
  });

  it('announces each change of text, not the first render nor a same-text re-render', () => {
    const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { rerender } = renderThemed(<StatusLine text="Not checked in yet" testID="line" />);
    expect(announce).not.toHaveBeenCalled();

    rerender(<StatusLine text="Not checked in yet" testID="line" />);
    expect(announce).not.toHaveBeenCalled();

    rerender(<StatusLine text="In since 09:12" testID="line" />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('In since 09:12');

    rerender(<StatusLine text="Done for today · 8 h 05 m" testID="line" />);
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('Done for today · 8 h 05 m');
    expect(screen.getByTestId('line').textContent).toBe('Done for today · 8 h 05 m');
  });
});
