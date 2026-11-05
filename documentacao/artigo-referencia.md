# Revisao da referência científica

## Identificacao

BRITO, Vitor Gabriel Sales de; FOPPA, Janecler; MARQUES, Maria Thais Silva; CARVALHO, Thiago Ferreira de. **Sistema de Irrigação Inteligente: Automacao e Eficiencia Utilizando Tecnologias IoT**. *Revista Brasileira de Estudos de Gestao e Desenvolvimento Regional*, v. 2, n. 1, p. 114–124, 2024. Publicado em 10/07/2024. DOI: https://doi.org/10.30681/rbegdr.v2i1.12628

Fonte original: https://periodicos.unemat.br/index.php/rbedrpp/article/view/12628
PDF: https://periodicos.unemat.br/index.php/rbedrpp/article/download/12628/8547/44350

## Problema e objetivo dos pesquisadores

Os autores buscaram regular o volume de irrigação para evitar falta/excesso de água e promover o uso mais eficiente dos recursos hidricos. O sistema foi inspirado em estruturas de ramificacao das raízes das plantas.

## Tecnologias identificadas

O artigo descreve placa ESP32, sensor de umidade do solo, relé, valvula solenoide, tubulacoes montadas inclusive com canudos e programação do controlador em Arduino IDE 2.3.2. A publicação discute a alimentacao/ramificacao da água no solo e apresenta fotografias do arranjo.

## Metodologia

Selecao dos componentes, integração física e eletrônica, programação da leitura do sensor e acionamento da valvula, ajuste dos tubos e da distribuição de água, testes praticos em condições de solo e plantas. Um trecho apresenta um limite de leitura `3000` como criterio de solo seco e descreve leituras ate `4967`.

## Resultados relatados — sem extrapolar

Os autores afirmam que o protótipo monitora o solo e controla a irrigação, com melhora qualitativa de eficiência e distribuição de água. O texto **não oferece uma tabela experimental suficientemente detalhada para atribuirmos uma porcentagem de economia de água, consumo medio ou significancia estatistica ao estudo**. Tais valores não devem ser inventados.

## Limites e observacoes criticas

- O artigo traz uma escala numerica de sensor que alcanca 4967. No **nosso** Wokwi, o ADC do ESP32 com resolucao de 12 bits retorna 0..4095. Por isso o valor de corte dos autores **não pode ser transportado literalmente** para nossa simulação.
- Os valores 40% e 70% são criterios escolhidos para a demonstração didatica, sem validacao agronomica ou calibracao física.
- O texto descreve resultados qualitativos, sem base para prometer um percentual de economia hídrica no trabalho do grupo.
- A interface de controle web e as proteções de timeout/histerese serão diferenciais de nossa proposta, sem atribui-las aos pesquisadores.

## Nossa solução original

Foco em horta de pequena escala, simulação com ESP32 e entrada analógica controlada no Wokwi, histerese de 40%/70%, módulo relé que alimenta um LED representativo, limites de seguranca, modos auto/manual e, em fases seguintes, monitoramento com interface propria via servidor intermediario.

**Importante:** testes e resultados desta implementacao serão registrados separadamente do estudo citado.
