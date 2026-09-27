<?php
declare(strict_types=1);

// Star Citizen Schiffskomponenten, gruppiert für das Auswahlfeld.
const COMPONENT_TYPES = [
    'Systeme' => [
        'Power Plant',
        'Cooler',
        'Shield Generator',
        'Quantum Drive',
        'Jump Module',
        'Radar',
        'Scanner',
        'Life Support',
        'Flight Controller',
        'Fuel Intake',
        'Fuel Tank',
        'Quantum Fuel Tank',
        'Thruster',
    ],
    'Bewaffnung' => [
        'Ship Weapon (Gun)',
        'Missile',
        'Missile Rack',
        'Torpedo',
        'Bomb',
        'Turret',
        'Countermeasure Launcher',
        'EMP Generator',
        'Quantum Interdiction Generator (QED)',
    ],
    'Utility' => [
        'Mining Laser',
        'Mining Module',
        'Salvage Head',
        'Salvage Modifier',
        'Tractor Beam',
        'Self-Destruct',
        'Paint / Livery',
    ],
    'Sonstiges' => [
        'Sonstiges',
    ],
];

// Klassen (Güte) der Komponenten, A = beste.
const COMPONENT_CLASSES = ['A', 'B', 'C', 'D'];

function component_type_valid(string $type): bool
{
    foreach (COMPONENT_TYPES as $group) {
        if (in_array($type, $group, true)) {
            return true;
        }
    }
    return false;
}
