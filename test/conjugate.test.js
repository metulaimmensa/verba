const assert = require('assert');
const { conjugate } = require('../www/conjugate.js');
const cases = {
  hablar: 'hablo hablas habla hablamos habláis hablan',
  tener: 'tengo tienes tiene tenemos tenéis tienen',
  pensar: 'pienso piensas piensa pensamos pensáis piensan',
  dormir: 'duermo duermes duerme dormimos dormís duermen',
  pedir: 'pido pides pide pedimos pedís piden',
  conocer: 'conozco conoces conoce conocemos conocéis conocen',
  seguir: 'sigo sigues sigue seguimos seguís siguen',
  construir: 'construyo construyes construye construimos construís construyen',
  enviar: 'envío envías envía enviamos enviáis envían',
  hacer: 'hago haces hace hacemos hacéis hacen',
};
for (const [v, exp] of Object.entries(cases)) {
  assert.strictEqual(conjugate(v).tenses.presente.map(f => f.form).join(' '), exp, v);
}
const ger = { comer: 'comiendo', leer: 'leyendo', dormir: 'durmiendo', pedir: 'pidiendo', sentir: 'sintiendo', 'bañarse': 'bañándose' };
for (const [v, g] of Object.entries(ger)) assert.strictEqual(conjugate(v).gerund, g, v);
assert.strictEqual(conjugate('bañarse').tenses.continuo[0].form, 'me estoy bañando');
console.log('Спряжение: все тесты прошли');
