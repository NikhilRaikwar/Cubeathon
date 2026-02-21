use dep::poseidon::poseidon::bn254;

fn main(
    maze: [u32; 64], // 8x8 grid
    maze_hash: pub Field,
    
    current_x: u32,
    current_y: u32,
    current_pos_hash: pub Field,
    
    move_dir: u32, // 0: N, 1: S, 2: E, 3: W
    
    new_x: u32,
    new_y: u32,
    new_pos_hash: pub Field
) {
    // 1. Verify Maze commitment
    let mut chunks = [0; 8];
    for i in 0..8 {
        let mut chunk = [0; 8];
        for j in 0..8 {
            chunk[j] = maze[i * 8 + j] as Field;
        }
        chunks[i] = bn254::hash_8(chunk);
    }
    let calculated_maze_hash = bn254::hash_8(chunks);
    assert(calculated_maze_hash == maze_hash);

    // 2. Verify current position commitment
    let calculated_current_hash = bn254::hash_2([current_x as Field, current_y as Field]);
    assert(calculated_current_hash == current_pos_hash);

    // 3. Verify move logic
    if move_dir == 0 { // North
        assert(new_y == current_y - 1);
        assert(new_x == current_x);
    } else if move_dir == 1 { // South
        assert(new_y == current_y + 1);
        assert(new_x == current_x);
    } else if move_dir == 2 { // East
        assert(new_x == current_x + 1);
        assert(new_y == current_y);
    } else { // West
        assert(new_x == current_x - 1);
        assert(new_y == current_y);
    }

    // 4. Boundary checks
    assert(new_x < 8);
    assert(new_y < 8);

    // 5. Collision check (Wall is 1, Path is 0)
    let index = new_y * 8 + new_x;
    assert(maze[index] == 0);

    // 6. Verify new position commitment
    let calculated_new_hash = bn254::hash_2([new_x as Field, new_y as Field]);
    assert(calculated_new_hash == new_pos_hash);
}

#[test]
fn test_valid_move() {
    let mut maze = [0; 64];
    maze[0] = 0; // Start
    maze[1] = 0; // Path
    maze[8] = 1; // Wall below
    
    let mut chunks = [0; 8];
    for i in 0..8 {
        let mut chunk = [0; 8];
        for j in 0..8 {
            chunk[j] = maze[i * 8 + j] as Field;
        }
        chunks[i] = bn254::hash_8(chunk);
    }
    let maze_hash = bn254::hash_8(chunks);
    
    let current_x = 0;
    let current_y = 0;
    let current_pos_hash = bn254::hash_2([current_x as Field, current_y as Field]);
    
    let move_dir = 2; // East
    let new_x = 1;
    let new_y = 0;
    let new_pos_hash = bn254::hash_2([new_x as Field, new_y as Field]);
    
    main(maze, maze_hash, current_x, current_y, current_pos_hash, move_dir, new_x, new_y, new_pos_hash);
}
