// Testes unitários dos utilitários usados em todo o front (fuso horário, telefone, URLs, erros).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToISO, dateKey, addDays, weekday, normalizePhone, isValidPhone, fmtPhone, safeUrl, socialUrl, errorMessage, esc } from '../js/ui.js';

test('zonedToISO converte horário local de São Paulo para UTC', () => {
  assert.equal(zonedToISO('2026-11-03', '10:00', 'America/Sao_Paulo'), '2026-11-03T13:00:00.000Z');
  assert.equal(zonedToISO('2026-11-03', '00:00', 'America/Sao_Paulo'), '2026-11-03T03:00:00.000Z');
  assert.equal(zonedToISO('2026-07-01', '09:30', 'America/Manaus'), '2026-07-01T13:30:00.000Z');
});

test('dateKey usa o fuso da barbearia (virada de dia)', () => {
  assert.equal(dateKey('2026-11-04T02:30:00Z', 'America/Sao_Paulo'), '2026-11-03');
  assert.equal(dateKey('2026-11-04T03:30:00Z', 'America/Sao_Paulo'), '2026-11-04');
});

test('addDays e weekday atravessam meses', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(weekday('2026-11-01'), 0);
});

test('telefone: normalização igual à do banco', () => {
  assert.equal(normalizePhone('(21) 98888-7777'), '5521988887777');
  assert.equal(normalizePhone('2133334444'), '552133334444');
  assert.equal(normalizePhone('+55 21 98888-7777'), '5521988887777');
  assert.equal(isValidPhone('123'), false);
  assert.equal(isValidPhone('21988887777'), true);
  assert.equal(fmtPhone('5521988887777'), '(21) 98888-7777');
});

test('URLs: bloqueia javascript: e monta redes sociais', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://x.com/a'), 'https://x.com/a');
  assert.equal(socialUrl('instagram', '@barbearia.vision'), 'https://instagram.com/barbearia.vision');
  assert.equal(socialUrl('tiktok', 'abc"><script>'), 'https://tiktok.com/@abcscript');
});

test('erros do banco viram mensagens amigáveis sem detalhes internos', () => {
  assert.match(errorMessage({ message: 'SLOT_UNAVAILABLE' }), /indisponível/);
  assert.match(errorMessage({ message: 'update or delete on table "services" violates foreign key constraint' }), /histórico/);
  assert.match(errorMessage(new Error('Failed to fetch')), /conexão/);
  assert.equal(esc('<b a="1">'), '&lt;b a=&quot;1&quot;&gt;');
});
