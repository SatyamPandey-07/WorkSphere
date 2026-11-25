import React from 'react';
import { render, screen } from '@testing-library/react';
import { sanitizeChatImageMarkdown } from '@/lib/chat/sanitize';
import { MessageItem } from '@/components/chat/MessageItem';

describe('chat markdown image sanitization', () => {
  it('converts untrusted tracking pixel markdown images into plain links', () => {
    const input = 'Check this out: ![tracking](https://httpbin.org/get)';
    const output = sanitizeChatImageMarkdown(input);

    expect(output).toBe('Check this out: [tracking](https://httpbin.org/get)');
    expect(output).not.toContain('![');
  });

  it('preserves trusted CDN images and renders with referrerPolicy="no-referrer"', () => {
    const trustedUrl =
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800';
    const sanitized = sanitizeChatImageMarkdown(`![workspace](${trustedUrl})`);
    expect(sanitized).toBe(`![workspace](${trustedUrl})`);

    render(
      <MessageItem
        senderName="Aarav"
        content={`![workspace](${trustedUrl}) ![pixel](https://attacker.com/tracking.gif)`}
      />
    );

    const img = screen.getByTestId('chat-trusted-image') as HTMLImageElement;
    expect(img.src).toBe(trustedUrl);
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');

    const link = screen.getByTestId('chat-sanitized-link') as HTMLAnchorElement;
    expect(link.textContent).toBe('pixel');
    expect(link.href).toBe('https://attacker.com/tracking.gif');
  });

  it('strips dangerous non-http protocols from image tags', () => {
    expect(sanitizeChatImageMarkdown('![xss](javascript:alert(1))')).toBe('xss');
  });
});
