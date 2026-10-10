# Climatiza

App para quem faz manutenção de ar condicionado: agenda de serviços, manutenção pré-agendada em 3 ou 6 meses, lembretes com WhatsApp, clientes CPF/CNPJ, estoque de materiais, orçamentos com PDF.

Login com Google ou com e-mail e senha (com confirmação de e-mail). Cada conta vê só os próprios dados, salvos no Firebase (Firestore).

## Arquivos

- `docs/index.html`: telas de login e do app
- `docs/app.js`: toda a lógica
- `docs/firebase-config.js`: chaves do seu projeto Firebase (preencher)
- `firestore.rules`: regras que protegem os dados de cada conta

## Configurar o Firebase (uma vez)

1. Em https://console.firebase.google.com crie um projeto (o plano gratuito Spark basta).
2. **Authentication > Sign-in method**: ative **Google** e **E-mail/senha**.
3. **Authentication > Settings > Domínios autorizados**: adicione `victor2700rodrigues-debug.github.io`.
4. **Firestore Database > Criar banco de dados** (modo produção, região `southamerica-east1`).
5. **Firestore > Regras**: cole o conteúdo de `firestore.rules` e publique.
6. **Configurações do projeto > Seus apps > Web (`</>`)**: registre um app e copie o objeto `firebaseConfig` para `firebase-config.js`.

## Publicar

No GitHub: **Settings > Pages > Build and deployment > Source: Deploy from a branch**, branch **main**, pasta **/docs**, **Save**. O site fica em `https://victor2700rodrigues-debug.github.io/Agenda/` e é atualizado a cada push na `main`.

Para testar no computador: `python3 -m http.server` dentro de `docs/` e abra http://localhost:8000.
