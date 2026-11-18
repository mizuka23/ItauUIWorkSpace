# Portal Itaú IU Workplace

Arquivos de publicação do portal em https://itau-ui-workplace.web.app.

## Estrutura

- `public/index.html`: aplicação atual, com estilos, bibliotecas e geração de relatórios incorporados.
- `public/cloud.js`: autenticação e sincronização da base compartilhada.
- `public/firebase-config.js`: identificadores públicos do aplicativo Firebase. A chave do SDK Web não substitui autenticação nem regras de acesso.
- `public/portal-merge.mjs`: conciliação de alterações simultâneas.
- `public/assets/capa-itau.png`: imagem da capa do relatório semanal.
- `firebase.json` e `.firebaserc`: configuração de hospedagem e projeto de destino.
- `firestore.rules`: regras de acesso existentes, preservadas para referência e implantação controlada.
- `scripts/validate.mjs`: validação da estrutura, da sintaxe e da ausência de dados incorporados ao HTML público.

A versão é estática e já está pronta para publicação; não exige uma etapa de compilação. O antigo HTML solto da raiz foi substituído pela estrutura `public/`. O histórico do Git preserva as versões anteriores.

## Publicação no Firebase

Instale Node.js 22 ou superior com npm. Abra um terminal na raiz deste repositório e execute:

```powershell
npm run validate
npm run firebase:login
npm run deploy
```

Use uma conta Google com autorização para publicar no projeto `itau-ui-workplace`. O login de publicação é independente do login dos usuários do portal. Conclua a autorização no seu computador; não inclua códigos de autenticação, senhas ou tokens em commits.

`npm run deploy` valida os arquivos e publica somente o Hosting. O comando não envia a base de dados nem altera Authentication ou regras do Firestore.

## Dados da equipe

O HTML público contém `ps-data` vazio. O portal recupera os registros após autenticação e verificação de permissão, usando o Firestore. Os dados existentes são mantidos ao publicar uma nova versão do site.

Não inclua neste repositório o HTML offline com dados corporativos, `base-inicial.json`, arquivos de backup, a pasta `private/`, a sessão da ferramenta Firebase, chaves de serviço ou arquivos `.env`.

As regras em `firestore.rules` são as mesmas da versão recuperada do projeto. A publicação delas deve ser feita separadamente, após revisão; o procedimento padrão deste repositório publica apenas o site.

## Alterações

Edite os arquivos em `public/`, execute `npm run validate` e publique com `npm run deploy`. O botão de exportação do portal pode produzir uma cópia com dados; não substitua `public/index.html` por essa cópia.

Este envio organiza os arquivos no GitHub. Não configura publicação automática nem cria credenciais de acesso para o GitHub Actions.
