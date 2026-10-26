import { createHmac, timingSafeEqual } from 'node:crypto';

import { UserRepository } from '@n8n/db';
import { Get, RestController } from '@n8n/decorators';
import type { Response } from 'express';

import { AuthService } from '@/auth/auth.service';
import { AuthlessRequest } from '@/requests';

type CliptoraSessionTicket = {
	exp: number;
	jti: string;
	next: string;
	sub: string;
};

const usedTickets = new Map<string, number>();
const allowedEditorPath = /^\/n8n\/(?:workflow\/[A-Za-z0-9_-]+)?$/;

@RestController()
export class CliptoraSsoController {
	constructor(
		private readonly authService: AuthService,
		private readonly userRepository: UserRepository,
	) {}

	@Get('/cliptora-sso', {
		skipAuth: true,
		ipRateLimit: { limit: 120, windowMs: 60_000 },
	})
	async exchange(req: AuthlessRequest, res: Response) {
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Referrer-Policy', 'no-referrer');

		const secret = process.env.CLIPTORA_N8N_SSO_SECRET?.trim() ?? '';
		const query = req.query as { token?: unknown };
		const token = typeof query.token === 'string' ? query.token : '';
		const payload = this.verifyTicket(token, secret);
		if (!payload) {
			res.status(401).send('CLIPTORA session ticket is invalid or expired.');
			return;
		}

		const owner = (await this.userRepository.findMany({ includeRole: true, limit: 20 })).find(
			(user) => user.role?.slug === 'global:owner',
		);
		if (!owner) {
			res.status(503).send('The n8n owner account is not initialized.');
			return;
		}

		usedTickets.set(payload.jti, payload.exp);
		this.authService.issueCookie(res, owner, owner.mfaEnabled);
		res.redirect(payload.next);
	}

	private verifyTicket(token: string, secret: string): CliptoraSessionTicket | undefined {
		if (secret.length < 32 || token.length > 4096) return undefined;
		const parts = token.split('.');
		if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;

		const expected = createHmac('sha256', secret).update(parts[0]).digest();
		let supplied: Buffer;
		try {
			supplied = Buffer.from(parts[1], 'base64url');
		} catch {
			return undefined;
		}
		if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;

		let payload: CliptoraSessionTicket;
		try {
			payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as CliptoraSessionTicket;
		} catch {
			return undefined;
		}

		const now = Math.floor(Date.now() / 1000);
		for (const [jti, expiry] of usedTickets) if (expiry < now) usedTickets.delete(jti);
		if (
			typeof payload.sub !== 'string' ||
			typeof payload.jti !== 'string' ||
			payload.jti.length < 16 ||
			!Number.isSafeInteger(payload.exp) ||
			payload.exp < now ||
			payload.exp > now + 60 ||
			typeof payload.next !== 'string' ||
			!allowedEditorPath.test(payload.next) ||
			usedTickets.has(payload.jti)
		) return undefined;

		return payload;
	}
}
