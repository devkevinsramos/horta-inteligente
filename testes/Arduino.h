#ifndef ARDUINO_H_MOCK
#define ARDUINO_H_MOCK

// Simulador minimo de Arduino exclusivamente para testes locais C++.
#include <cstdint>
#include <deque>
#include <string>
#include <sstream>
#include <cstdarg>
#include <cstdio>

using uint8_t = std::uint8_t;
constexpr int HIGH = 1;
constexpr int LOW = 0;
constexpr int INPUT = 0;
constexpr int OUTPUT = 1;

extern unsigned long simTempoMs;
extern int simAdc;
extern int simRele;

inline unsigned long millis() { return simTempoMs; }
inline int analogRead(int) { return simAdc; }
inline void analogReadResolution(int) {}
inline void pinMode(int, int) {}
inline void digitalWrite(int pin, int valor) {
  if (pin == 26) simRele = valor;
}

struct SerialSimulado {
  std::string saida;
  std::deque<char> entrada;

  void begin(int) {}
  template <class T> void print(const T& valor) {
    std::ostringstream s; s << valor; saida += s.str();
  }
  template <class T> void println(const T& valor) {
    print(valor); saida += "\n";
  }
  void println() { saida += "\n"; }
  void printf(const char* formato, ...) {
    char buffer[512];
    va_list args; va_start(args, formato);
    std::vsnprintf(buffer, sizeof(buffer), formato, args);
    va_end(args); saida += buffer;
  }
  int available() { return static_cast<int>(entrada.size()); }
  int read() {
    if (entrada.empty()) return -1;
    char valor = entrada.front(); entrada.pop_front(); return valor;
  }
  void inserir(const std::string& comando) {
    for (char c : comando) entrada.push_back(c);
    entrada.push_back('\n');
  }
};
extern SerialSimulado Serial;
#endif
