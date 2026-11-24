/**
 * df-decode v1.0 — Galería de Ejemplos Clásicos e Interactivos
 * Incluye ejemplos de:
 * 1. Suma y Promedio de 2 Números (Básico)
 * 2. Conversión Decimal a Binario (Algoritmo Clásico)
 * 3. Factorial Recursivo con Subprograma (Algoritmo Clásico)
 * 4. Serie de Fibonacci (Ciclo Para)
 * 5. Verificador de Número Primo (Ciclo Mientras + Decisión)
 * 6. Ordenamiento Burbuja con Vectores (Arreglos y Ciclos Anidados)
 */

(function (global) {
  'use strict';

  const { createMainSheet, createSubprogramSheet, createNode } = global.DFDModel;

  const EXAMPLES = [
    {
      id: 'hola-suma',
      title: '1. Suma y Promedio de 2 Números (Básico)',
      build() {
        const main = createMainSheet('Calcula la suma y el promedio de dos números ingresados por teclado.');
        main.body = [
          createNode('IMPRESION', { text: "'Ingrese dos números para calcular su suma y promedio:'" }),
          createNode('LECTURA', { text: 'A, B' }),
          createNode('ASIGNACION', {
            assignments: [
              { target: 'Suma', expr: 'A + B' },
              { target: 'Promedio', expr: 'Suma / 2' }
            ]
          }),
          createNode('IMPRESION', { text: "'La suma es: ', Suma, ' y el promedio es: ', Promedio" })
        ];
        return {
          format: 'DFX',
          version: '1.0',
          anglesInDegrees: true,
          activeSheetIndex: 0,
          sheets: [main]
        };
      }
    },
    {
      id: 'decimal-binario',
      title: '2. Conversión Decimal a Binario (Algoritmo Clásico)',
      build() {
        const main = createMainSheet('Muestra la conversión de un número entero decimal positivo a binario.');
        main.body = [
          createNode('LECTURA', { text: 'Num' }),
          createNode('ASIGNACION', {
            assignments: [
              { target: 'Num', expr: 'TRUNC(Num)' },
              { target: 'Cad', expr: "''" }
            ]
          }),
          createNode('DECISION', {
            condition: 'Num > 0',
            yesLeft: false,
            noBranch: [
              createNode('DECISION', {
                condition: 'Num = 0',
                yesLeft: false,
                noBranch: [
                  createNode('IMPRESION', { text: "'No se convierten números negativos'" })
                ],
                yesBranch: [
                  createNode('IMPRESION', { text: "'0'" })
                ]
              })
            ],
            yesBranch: [
              createNode('CICLOMIENTRAS', {
                condition: 'Num > 0',
                body: [
                  createNode('ASIGNACION', {
                    assignments: [{ target: 'Par', expr: 'Num MOD 2 = 0' }]
                  }),
                  createNode('DECISION', {
                    condition: 'Par',
                    yesLeft: true,
                    yesBranch: [
                      createNode('ASIGNACION', {
                        assignments: [{ target: 'Cad', expr: "'0' + Cad" }]
                      })
                    ],
                    noBranch: [
                      createNode('ASIGNACION', {
                        assignments: [{ target: 'Cad', expr: "'1' + Cad" }]
                      })
                    ]
                  }),
                  createNode('ASIGNACION', {
                    assignments: [{ target: 'Num', expr: 'TRUNC(Num / 2)' }]
                  })
                ]
              }),
              createNode('IMPRESION', { text: "'En binario es: ', Cad" })
            ]
          })
        ];
        return {
          format: 'DFX',
          version: '1.0',
          anglesInDegrees: true,
          activeSheetIndex: 0,
          sheets: [main]
        };
      }
    },
    {
      id: 'factorial-recursivo',
      title: '3. Factorial con Subprograma Recursivo (Algoritmo Clásico)',
      build() {
        const main = createMainSheet('Obtiene e imprime el factorial de un número N usando un subprograma recursivo.');
        main.body = [
          createNode('LECTURA', { text: 'N' }),
          createNode('LLAMADA', { subName: 'Fact', args: 'X, N' }),
          createNode('IMPRESION', { text: "'El factorial de ', N, ' es: ', X" })
        ];

        const sub = createSubprogramSheet(
          'Fact',
          'X, Nivel',
          "Rutina recursiva que obtiene el factorial de 'Nivel' y lo retorna en X"
        );
        sub.body = [
          createNode('DECISION', {
            condition: 'Nivel > 0',
            yesLeft: false,
            noBranch: [
              createNode('ASIGNACION', {
                assignments: [{ target: 'X', expr: '1' }]
              })
            ],
            yesBranch: [
              createNode('LLAMADA', { subName: 'Fact', args: 'Temp, Nivel - 1' }),
              createNode('ASIGNACION', {
                assignments: [{ target: 'X', expr: 'Temp * Nivel' }]
              })
            ]
          })
        ];

        return {
          format: 'DFX',
          version: '1.0',
          anglesInDegrees: true,
          activeSheetIndex: 0,
          sheets: [main, sub]
        };
      }
    },
    {
      id: 'fibonacci-para',
      title: '4. Sucesión de Fibonacci (Ciclo Para)',
      build() {
        const main = createMainSheet('Genera los primeros N términos de la sucesión de Fibonacci.');
        main.body = [
          createNode('LECTURA', { text: 'N' }),
          createNode('ASIGNACION', {
            assignments: [
              { target: 'a', expr: '0' },
              { target: 'b', expr: '1' }
            ]
          }),
          createNode('CICLOPARA', {
            counter: 'i',
            start: '1',
            end: 'N',
            step: '1',
            body: [
              createNode('IMPRESION', { text: "'Término ', i, ': ', a" }),
              createNode('ASIGNACION', {
                assignments: [
                  { target: 'sig', expr: 'a + b' },
                  { target: 'a', expr: 'b' },
                  { target: 'b', expr: 'sig' }
                ]
              })
            ]
          })
        ];
        return {
          format: 'DFX',
          version: '1.0',
          anglesInDegrees: true,
          activeSheetIndex: 0,
          sheets: [main]
        };
      }
    },
    {
      id: 'detector-primo',
      title: '5. Detector de Número Primo (Ciclo Mientras)',
      build() {
        const main = createMainSheet('Determina si un número entero N es primo o compuesto.');
        main.body = [
          createNode('LECTURA', { text: 'N' }),
          createNode('ASIGNACION', {
            assignments: [
              { target: 'esPrimo', expr: 'N >= 2' },
              { target: 'div', expr: '2' }
            ]
          }),
          createNode('CICLOMIENTRAS', {
            condition: 'esPrimo AND (div * div <= N)',
            body: [
              createNode('DECISION', {
                condition: 'N MOD div = 0',
                yesLeft: true,
                yesBranch: [
                  createNode('ASIGNACION', {
                    assignments: [{ target: 'esPrimo', expr: '.F.' }]
                  })
                ],
                noBranch: [
                  createNode('ASIGNACION', {
                    assignments: [{ target: 'div', expr: 'div + 1' }]
                  })
                ]
              })
            ]
          }),
          createNode('DECISION', {
            condition: 'esPrimo',
            yesLeft: true,
            yesBranch: [
              createNode('IMPRESION', { text: "N, ' ES un número primo.'" })
            ],
            noBranch: [
              createNode('IMPRESION', { text: "N, ' NO es un número primo.'" })
            ]
          })
        ];
        return {
          format: 'DFX',
          version: '1.0',
          anglesInDegrees: true,
          activeSheetIndex: 0,
          sheets: [main]
        };
      }
    },
    {
      id: 'vectores-burbuja',
      title: '6. Vectores: Ordenamiento Burbuja (Arreglos)',
      build() {
        const main = createMainSheet('Crea un vector de 5 elementos, lo ordena de menor a mayor con el método Burbuja y lo muestra.');
        main.body = [
          createNode('ASIGNACION', {
            assignments: [
              { target: 'N', expr: '5' },
              { target: 'V(1)', expr: '42' },
              { target: 'V(2)', expr: '15' }
            ]
          }),
          createNode('ASIGNACION', {
            assignments: [
              { target: 'V(3)', expr: '8' },
              { target: 'V(4)', expr: '99' },
              { target: 'V(5)', expr: '23' }
            ]
          }),
          createNode('CICLOPARA', {
            counter: 'i',
            start: '1',
            end: 'N - 1',
            step: '1',
            body: [
              createNode('CICLOPARA', {
                counter: 'j',
                start: '1',
                end: 'N - i',
                step: '1',
                body: [
                  createNode('DECISION', {
                    condition: 'V(j) > V(j + 1)',
                    yesLeft: true,
                    yesBranch: [
                      createNode('ASIGNACION', {
                        assignments: [
                          { target: 'aux', expr: 'V(j)' },
                          { target: 'V(j)', expr: 'V(j + 1)' },
                          { target: 'V(j + 1)', expr: 'aux' }
                        ]
                      })
                    ],
                    noBranch: []
                  })
                ]
              })
            ]
          }),
          createNode('CICLOPARA', {
            counter: 'k',
            start: '1',
            end: 'N',
            step: '1',
            body: [
              createNode('IMPRESION', { text: "'V(', k, ') = ', V(k)" })
            ]
          })
        ];
        return {
          format: 'DFX',
          version: '1.0',
          anglesInDegrees: true,
          activeSheetIndex: 0,
          sheets: [main]
        };
      }
    }
  ];

  global.DFDExamples = {
    EXAMPLES
  };
})(window);
