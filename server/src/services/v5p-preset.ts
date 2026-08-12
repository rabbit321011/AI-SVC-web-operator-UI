export const V5P_RUNTIME = 'E:/MyProject/ToLinuxServer/package_v4c_finetune'
export const V5P_PYTHON = 'C:/Users/jbbj/AppData/Local/Programs/Python/Python310/python.exe'
export const SINGER_ROOT = 'E:/AIscene/YingMusic_Singer_Plus'
export const V5P_DIRECT_RUNNER = 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_runner.py'

export const V5P_DIRECT_PRESET = {
  id: 'V5P_40K_EMA',
  checkpoint: 'E:/MyProject/重要模型保存/V5P_40K_EMA/step_040000_final.pt',
  checkpointSHA256: '3a532f5bd5965dff7d011996b7ca72d7884c5494a2d44d6c28b0bab21bace96c',
  checkpointSchema: 'v5p_training_checkpoint_v1',
  checkpointStep: 40000,
  weightSource: 'ema_model_state_dict',
  trainingCodeSHA256: '68ca0d402a79a0ffddaec0a740d4c1ae1edd4732ce93ca5d30240fdc75a9ed8f',
  modelConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/YingMusic_Singer.yaml',
  modelConfigSHA256: 'e378b3b0891e82b0b03a2e183adca292c7c17e7fbd9bec9acfe426a3596f567d',
  vaeConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/stable_audio_2_0_vae_20hz_official.json',
  vaeConfigSHA256: '6c70de797bae6a3362ed7f2afb91d19ce5c979cdd2dbfa4ae000b9bdef02acbc',
  vaeCheckpoint: `${SINGER_ROOT}/ckpts/stable_audio_2_0_vae_20hz_official.ckpt`,
  vaeCheckpointSHA256: 'dc2c4a8ec9731594951a27eff4a188a89b82859649c341c51d050101d1ce0b39',
  placement: `${V5P_RUNTIME}/h_alignment/placement.py`,
  placementSHA256: '086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee',
  directControlAdapter: 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_control.py',
  directRunner: V5P_DIRECT_RUNNER,
  python: V5P_PYTHON,
  singerRoot: SINGER_ROOT,
  melodyHashes: {
    'game_cache_v4ph.py': '2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd',
    'game_cka_v4ph.py': '43071b4b4401e202f84e86a729694e4973118b8a4132128f52eacd3e16fb94ba',
    'game_p_v4pf.py': '5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8',
    'game_runtime_v4ph.py': 'cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4',
    'midi_p_v4ph.py': 'b33101ac135815bfcd3a3a2ba2233ddee0f5f7321285327871758804119e271f',
  },
} as const
