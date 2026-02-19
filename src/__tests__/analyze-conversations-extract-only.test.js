const { buildSingleNumberMdContent } = require('../scripts/analyze-conversations');

describe('analyze-conversations --extract-only', () => {
  it('returns only full thread section when extractOnly=true', () => {
    const out = buildSingleNumberMdContent({
      mdTable: 'SHOULD_NOT_APPEAR',
      fullThread: 'Eu: Oi\nCliente: Oi',
      qtdMensagens: 2,
      extractOnly: true,
    });

    expect(out).toContain('## Conversa completa (2 mensagens)');
    expect(out).toContain('Eu: Oi');
    expect(out).toContain('Cliente: Oi');
    expect(out).not.toContain('SHOULD_NOT_APPEAR');
    expect(out).not.toContain('| Contato |');
  });

  it('includes table and separator when extractOnly=false', () => {
    const out = buildSingleNumberMdContent({
      mdTable: '| Contato | Nome |',
      fullThread: 'Eu: Teste',
      qtdMensagens: 1,
      extractOnly: false,
    });

    expect(out).toContain('| Contato | Nome |');
    expect(out).toContain('\n\n---\n\n## Conversa completa (1 mensagens)\n\n');
    expect(out).toContain('Eu: Teste');
  });
});

