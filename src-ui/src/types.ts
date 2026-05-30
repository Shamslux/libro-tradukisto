import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './App.css';
import languages from './languages.json';
import locales from './locales.json';


import type { Chapter } from './types'; 

type LocaleKeys = keyof typeof locales;

interface ExtractedChapter {
  id: string;
  title: string;
  content: string;
}