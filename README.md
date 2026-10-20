# Boreal Workstation

Código preparado para o repositório Adm6240/boreal1-crm em 20/10/2026.

## Preparar e verificar

Requer Node.js 24 ou superior e npm. Na pasta do projeto:

```sh
npm ci
npm run build
npm test
```

O build precisa ocorrer antes dos testes, pois gera os recursos estáticos importados pelo servidor.

## Hospedagem

Este sistema usa um Worker com armazenamento DB (D1) e BUCKET (R2). O envio ao GitHub guarda o código; não coloca o sistema em funcionamento automaticamente. Não há comando de servidor local nesta versão.

A configuração privada `.openai/hosting.json` foi excluída. Ela é opcional para compilar, mas a implantação requer a configuração da plataforma e seus recursos. Os conectores de impressão usam um endereço de exemplo, que deve ser configurado antes do uso. A identidade administrativa também foi substituída por um exemplo e exige revisão antes da implantação.

As migrações em `drizzle/` preservam a estrutura e o histórico técnico. Algumas alteram ou apagam registros: não executá-las em banco existente sem revisão e backup.

## Privacidade

Não acompanham esta cópia: histórico Git anterior, configurações de hospedagem, arquivos de ambiente reais, dependências instaladas, builds, backups e pacotes de versões antigas. O arquivo de dados comerciais usado nos testes de interface e o teste dependente foram excluídos. Os demais testes foram preservados.

Endereços pessoais identificados, nomes específicos e a URL da instalação anterior foram substituídos por exemplos. As senhas com prefixo Fixture nos testes são dados fictícios; o hash de fallback em users.mjs é usado na comparação de autenticação quando não há usuário, e não cadastra uma conta.

Segredos devem ser cadastrados na plataforma de hospedagem, fora do Git. Esta cópia foi revisada por padrões e inspeção direcionada; isso não equivale a uma auditoria completa de segurança.
