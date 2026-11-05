#include <iostream>
#include <stdexcept>
#include <string>

unsigned long simTempoMs = 0;
int simAdc = 0;
int simRele = 0;
#include "Arduino.h"
SerialSimulado Serial;
#include "../wokwi/sketch.ino"

int executados = 0;

void verificar(bool condicao, const char* descricao) {
  ++executados;
  if (!condicao) throw std::runtime_error(descricao);
}

int adcParaPercentual(int percentual) { return (percentual * 4095) / 100; }

void novoCenario(int percentual) {
  simTempoMs = 0;
  simAdc = adcParaPercentual(percentual);
  simRele = 0;
  Serial = SerialSimulado{};
  inicioIrrigacaoMs = 0;
  ultimaLeituraMs = 0;
  ultimaTelemetriaMs = 0;
  setup();
}

void passarTempo(unsigned long tempo) {
  unsigned long final = simTempoMs + tempo;
  while (simTempoMs < final) {
    simTempoMs += (final - simTempoMs >= 250) ? 250 : final - simTempoMs;
    loop();
  }
}

void comando(const std::string& c) {
  Serial.inserir(c);
  loop();
}

int main() {
  try {
    novoCenario(20);
    verificar(irrigando && simRele == HIGH, "Solo seco deve ligar rele");
    verificar(modo == ModoOperacao::AUTOMATICO, "Modo inicial automatico");

    novoCenario(55);
    verificar(!irrigando && simRele == LOW, "Umidade media inicial nao deve ligar");
    simAdc = adcParaPercentual(30); passarTempo(250);
    verificar(irrigando, "Umidade abaixo de 40 deve ligar");
    simAdc = adcParaPercentual(50); passarTempo(250);
    verificar(irrigando, "Histerese deve manter ligado entre 40 e 69");
    simAdc = adcParaPercentual(70); passarTempo(250);
    verificar(!irrigando && simRele == LOW, "70 deve desligar");

    novoCenario(40);
    verificar(!irrigando, "Exatamente 40 nao deve iniciar");
    novoCenario(39);
    verificar(irrigando, "39 deve iniciar");

    novoCenario(20);
    comando("MANUAL");
    verificar(!irrigando && modo == ModoOperacao::MANUAL, "Troca manual deve parar");
    comando("LIGAR");
    verificar(irrigando && simRele == HIGH, "Manual deve ligar");
    comando("DESLIGAR");
    verificar(!irrigando, "Manual deve desligar");
    comando("AUTO");
    verificar(irrigando && modo == ModoOperacao::AUTOMATICO, "Retorno automatico deve religar solo seco");

    novoCenario(20);
    comando("DESLIGAR");
    verificar(!irrigando && modo == ModoOperacao::MANUAL, "Parada humana deve sair do automatico");
    passarTempo(2000);
    verificar(!irrigando, "Parada humana nao deve religar automaticamente");

    novoCenario(20);
    passarTempo(30000);
    verificar(!irrigando && bloqueioPorTempo && simRele == LOW, "Timeout deve desligar e bloquear");
    comando("MANUAL"); comando("LIGAR");
    verificar(!irrigando && bloqueioPorTempo, "Manual nao pode furar bloqueio de tempo");
    comando("RESET");
    verificar(!bloqueioPorTempo && !irrigando, "RESET em manual deve rearmar sem ligar");
    comando("LIGAR");
    verificar(irrigando, "Depois do reset manual pode ligar");

    novoCenario(20);
    comando("FALHA");
    verificar(!leituraValida && !irrigando && simRele == LOW, "Falha injetada deve desligar");
    verificar(Serial.saida.find("\"umidade\":null") != std::string::npos, "JSON invalido deve ter null");
    comando("RESET");
    verificar(!leituraValida, "RESET nao cancela falha do sensor");
    comando("NORMAL");
    verificar(leituraValida && irrigando, "Ao remover falha, automatico pode voltar");

    novoCenario(80);
    comando("MANUAL"); comando("LIGAR");
    verificar(!irrigando, "Manual deve bloquear irrigacao acima de 70");
    novoCenario(20);
    comando("LIGAR");
    verificar(irrigando && modo == ModoOperacao::AUTOMATICO, "LIGAR nao muda modo automatico");
    verificar(Serial.saida.find("comando_ligar_rejeitado_modo_automatico") != std::string::npos, "Comando indevido deve gerar evento");

    novoCenario(50);
    comando("STATUS");
    verificar(Serial.saida.find("\"tipo\":\"telemetria\"") != std::string::npos, "Telemetria JSON presente");
    verificar(Serial.saida.find("\"dispositivo\":\"horta-esp32-01\"") != std::string::npos, "ID estavel");
    verificar(simRele == LOW, "Estado fisico inicial seguro");

    std::cout << "OK: " << executados << " verificacoes automatizadas da logica e comandos.\n";
    std::cout << "AVISO: isso NAO e um teste na plataforma Wokwi.\n";
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "FALHOU na verificacao " << executados << ": " << e.what() << "\n";
    return 1;
  }
}
