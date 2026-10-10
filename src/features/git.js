export async function gitInitRepo(fs, dir) {
  return git.init({ fs, dir, defaultBranch: 'main' });
}

export async function gitStatus(fs, dir) {
  return git.statusMatrix({ fs, dir });
}

export async function gitCommit(fs, dir, message, author) {
  return git.commit({ fs, dir, message, author });
}
